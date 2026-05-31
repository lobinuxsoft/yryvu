// SPDX-License-Identifier: AGPL-3.0-or-later

use std::collections::HashSet;

#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub enum RefKind {
    #[default]
    Branch,
    RemoteBranch,
    Tag,
    Head,
}

/// Per-row kind discriminator, mirroring GitKraken's `node_type` enum
/// (bundle constants at `:241969`). All four variants flow through the
/// same `<RowRenderer>` pipeline — the renderer keys off this value to
/// pick a node glyph (circle / rounded rect / dashed circle) and to
/// flip the parent-edge stroke to dashed for non-commit/merge rows
/// (GK predicate `!(type === commit || type === merge)`).
///
/// `Default = Commit` matches the input shape consumers populate first;
/// the lane allocator overrides to `Merge` post-hoc for `parents.len() > 1`
/// when the input was left at the default.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub enum NodeType {
    #[default]
    Commit,
    Merge,
    /// `refs/stash@{N}` tip — emitted by the bridge via `collect_stash_tips`
    /// and tagged in `walk_commits`. Message is overridden to the stash
    /// subject; parent edge to HEAD is dashed.
    Stash,
    /// Synthetic working-tree row, prepended by the bridge when the tree
    /// is dirty. Sentinel sha (never a real Git object), lane / color
    /// borrowed from HEAD. Issue #174 unifies WIP through this variant.
    WorkDir,
}

/// Union of ref names reachable from this commit's descendants, bucketed by kind.
///
/// Populated by [`crate::populate_child_refs`] during layout. Consumed by the
/// hover-dim pass on the frontend (issue #54) to answer
/// "is this commit an ancestor of the hovered ref's tip?" in O(1) without
/// walking the DAG on each hover event.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct ChildRefs {
    pub heads: HashSet<String>,
    pub remotes: HashSet<String>,
    pub tags: HashSet<String>,
}

/// A ref pointing at the row's commit.
///
/// `upstream` / `ahead` / `behind` are populated for local branches that have
/// a tracking remote branch configured (`branch.<name>.remote` +
/// `branch.<name>.merge`). Remote branches, tags, and `HEAD` always carry the
/// defaults `(None, 0, 0)`. Resolution + counts are computed via git2's
/// `graph_ahead_behind` because gix 0.68 lacks a stable equivalent — see
/// `repo/commits.rs::resolve_upstream_tracking`.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct RefTag {
    pub name: String,
    pub kind: RefKind,
    /// Short name of the tracked remote branch (e.g. `origin/main`). `None`
    /// when the local branch has no upstream configured or this ref isn't a
    /// local branch.
    #[cfg_attr(feature = "serde", serde(default))]
    pub upstream: Option<String>,
    /// Commits this local branch has that the upstream doesn't.
    #[cfg_attr(feature = "serde", serde(default))]
    pub ahead: u32,
    /// Commits the upstream has that this local branch doesn't.
    #[cfg_attr(feature = "serde", serde(default))]
    pub behind: u32,
}

/// Input commit — caller is responsible for providing commits in reverse-topological order
/// (children before parents).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Commit {
    pub sha: String,
    pub parents: Vec<String>,
    /// First line of the commit message. Consumers rendering the full message
    /// should concatenate `summary` + (blank line) + `body` when `body` is
    /// non-empty; the inspector right-panel renders them as separate elements
    /// matching GitKraken (`<p>` subject, `<pre>` body).
    pub summary: String,
    /// Message body — everything after the subject line, with the separating
    /// blank line trimmed. Raw content (no trailer stripping) to match
    /// GitKraken's render pipeline which emojify-only transforms the body.
    pub body: String,
    pub author_name: String,
    pub author_email: String,
    pub author_date: i64,
    /// Committer name when the commit has a distinct committer from the author
    /// (e.g. cherry-picked, rebased, PR-merged commits). `None` when the gix
    /// backend can't decode committer info; in practice present for all
    /// well-formed commits. Frontend gates the committer block on both this
    /// being `Some` AND differing from `author_name`/`author_email`.
    pub committer_name: Option<String>,
    pub committer_email: Option<String>,
    pub committer_date: Option<i64>,
    pub refs: Vec<RefTag>,
    /// Per-row kind. `Default = Commit`. The bridge sets `Stash` for
    /// `refs/stash@{N}` tips and `WorkDir` for the synthetic dirty-tree
    /// row; `Merge` is derived in `layout_commits` from `parents.len() > 1`
    /// when the input was left at the default. Mirrors GK's `node_type`
    /// constants (bundle `:241969`).
    pub node_type: NodeType,
}

impl Commit {
    /// Convenience: the legacy `"Name <email>"` format used elsewhere in the
    /// codebase (commit-list panel, detail inspector) until those consumers
    /// switch to the split fields.
    pub fn author_display(&self) -> String {
        format!("{} <{}>", self.author_name, self.author_email)
    }
}

/// Output row ready for the renderer.
///
/// `parent_lanes` and `parent_shas` are aligned: index `i` in both refers to the
/// same parent commit. `parent_shas` lets the renderer look up the parent's
/// actual row rather than assuming it is the immediately-next row.
#[derive(Debug, Default, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct GraphRow {
    pub sha: String,
    pub short_sha: String,
    pub summary: String,
    /// Commit message body (no trailer stripping). Empty string when the
    /// commit has only a subject line. Serialized always — fixtures generated
    /// before this field was added tolerate the serde default via `#[serde(default)]`.
    #[cfg_attr(feature = "serde", serde(default))]
    pub body: String,
    pub author_name: String,
    pub author_email: String,
    /// Two-character badge rendered as a fallback when no avatar image loads.
    /// Computed via [`author_initials`] at layout time so the frontend
    /// doesn't re-derive on every render.
    pub author_initials: String,
    /// Lowercase hex MD5 of the trimmed-lowercased author email — the
    /// Gravatar URL fragment (`https://gravatar.com/avatar/<hash>?s=36&d=404`).
    /// Pre-computed so the frontend composes the URL cheaply and caches by
    /// email without repeating the hash.
    pub gravatar_hash: String,
    pub author_date: i64,
    /// Committer identity, populated when the commit has a distinct committer
    /// from the author. The inspector right-panel renders the committer block
    /// only when both conditions hold: `committer_*` is `Some` AND at least one
    /// of name/email differs from the author. Matches the GitKraken bundle
    /// guard `!committerInfo || (email===authorEmail && name===authorName)`.
    #[cfg_attr(feature = "serde", serde(default))]
    pub committer_name: Option<String>,
    #[cfg_attr(feature = "serde", serde(default))]
    pub committer_email: Option<String>,
    #[cfg_attr(feature = "serde", serde(default))]
    pub committer_date: Option<i64>,
    /// Pre-computed initials + gravatar hash for the committer. `None` when
    /// there is no committer info; identical to the author values when the
    /// committer matches the author (frontend still renders at most one block
    /// per the guard above).
    #[cfg_attr(feature = "serde", serde(default))]
    pub committer_initials: Option<String>,
    #[cfg_attr(feature = "serde", serde(default))]
    pub committer_gravatar_hash: Option<String>,
    pub lane: u16,
    pub parent_lanes: Vec<u16>,
    pub parent_shas: Vec<String>,
    pub color_idx: u16,
    pub refs: Vec<RefTag>,
    pub is_merge: bool,
    /// Per-row kind, propagated from [`Commit::node_type`]. The frontend
    /// switches on this to pick the node glyph (circle / rounded rect /
    /// dashed circle) and to dash the parent edge when the row is non-
    /// commit/merge. `is_merge` is kept alongside for the existing
    /// renderer call-sites that haven't migrated to `node_type` yet.
    #[cfg_attr(feature = "serde", serde(default))]
    pub node_type: NodeType,
    /// Refs reachable from this commit's strict descendants (not including the
    /// row's own refs — those live in [`refs`] and are checked separately by
    /// consumers). Populated post-layout via [`crate::populate_child_refs`].
    #[cfg_attr(feature = "serde", serde(default))]
    pub child_refs: ChildRefs,
    /// Lane indices that carry a visual edge through this row (sorted
    /// ascending, deduplicated). The per-row renderer uses this to draw a
    /// vertical pipe segment confined to the row's height at each listed lane.
    ///
    /// Includes the commit's own lane, any lane carrying an edge coming down
    /// from earlier rows (pre-place snapshot), and any lane reserved for a
    /// parent below (post-place snapshot). Union of both snapshots guarantees
    /// coverage of lane-terminating rows where a lane ends precisely at this
    /// row (merge-back, parent-less leaf, steal deferred free).
    #[cfg_attr(feature = "serde", serde(default))]
    pub active_lanes: Vec<u16>,
}

/// Two-letter initials badge for an author name. Heuristics:
///
/// - Split `name` on whitespace, drop empty tokens.
/// - If 0 tokens → fall back to the first char of `email`'s local-part,
///   else `"?"` when even that is unavailable.
/// - If 1 token → first + second char of that token (uppercased), or
///   just the first letter if the token is a single grapheme.
/// - If 2+ tokens → first char of the first token + first char of the
///   last token, uppercased.
///
/// Matches the GitKraken `authorInitials` prop surface used by
/// `getDefaultAvatar` (bundle @225102) for the initials-badge fallback.
pub fn author_initials(name: &str, email: &str) -> String {
    let tokens: Vec<&str> = name.split_whitespace().collect();
    match tokens.len() {
        0 => {
            let Some(local) = email.split('@').next() else {
                return "?".to_string();
            };
            let Some(first) = local.chars().next() else {
                return "?".to_string();
            };
            first.to_uppercase().to_string()
        }
        1 => {
            let mut it = tokens[0].chars();
            let first = it
                .next()
                .map(|c| c.to_uppercase().to_string())
                .unwrap_or_default();
            let second = it
                .next()
                .map(|c| c.to_uppercase().to_string())
                .unwrap_or_default();
            format!("{first}{second}")
        }
        _ => {
            let first_token = tokens.first().copied().unwrap_or_default();
            let last_token = tokens.last().copied().unwrap_or_default();
            let first = first_token
                .chars()
                .next()
                .map(|c| c.to_uppercase().to_string())
                .unwrap_or_default();
            let last = last_token
                .chars()
                .next()
                .map(|c| c.to_uppercase().to_string())
                .unwrap_or_default();
            format!("{first}{last}")
        }
    }
}

/// Split a full commit message into `(subject, body)`.
///
/// Subject is everything up to the first newline (`\n` or `\r`); body is
/// everything after, with leading newline characters trimmed so the two
/// forms `"subj\n\nbody"` and `"subj\nbody"` both produce body `"body"`.
///
/// Matches the GitKraken render pipeline (`03-message-section.md`):
/// char-by-char iteration, first delimiter wins, no regex. The blank-line
/// separator convention is git's canonical format (`git show --format='%s%n%n%b'`).
/// Trailing whitespace on the body is preserved — consumers decide whether
/// to trim.
///
/// Empty input returns `("", "")`. Subject-only input (no newline) returns
/// `(input, "")`. Body is never `None`; the empty string covers both cases.
pub fn split_message(full: &str) -> (String, String) {
    match full.find(['\n', '\r']) {
        Some(idx) => {
            let subject = full[..idx].to_string();
            let body = full[idx..].trim_start_matches(['\n', '\r']).to_string();
            (subject, body)
        }
        None => (full.to_string(), String::new()),
    }
}

/// Lowercase-hex MD5 of the trimmed-lowercased email, as Gravatar expects.
/// Returns a 32-char hex string (stable across callers so avatars can be
/// keyed by email without re-hashing per render).
pub fn gravatar_hash(email: &str) -> String {
    use md5::{Digest, Md5};
    let normalized = email.trim().to_lowercase();
    let digest = Md5::digest(normalized.as_bytes());
    let mut out = String::with_capacity(32);
    for byte in digest {
        // Manual hex rather than `format!` in a loop — tight.
        const HEX: &[u8; 16] = b"0123456789abcdef";
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initials_two_words() {
        assert_eq!(author_initials("John Doe", "john@doe.com"), "JD");
    }

    #[test]
    fn initials_single_word_uses_first_two_chars() {
        assert_eq!(author_initials("Cher", "c@x.com"), "CH");
    }

    #[test]
    fn initials_three_words_uses_first_and_last() {
        assert_eq!(author_initials("Jose Maria Lopez", "jml@x.com"), "JL");
    }

    #[test]
    fn initials_empty_name_falls_back_to_email_local_part() {
        assert_eq!(author_initials("", "alice@example.com"), "A");
    }

    #[test]
    fn initials_empty_name_empty_email_question_mark() {
        assert_eq!(author_initials("", ""), "?");
    }

    #[test]
    fn initials_unicode_two_words() {
        // Confirms chars() iteration plus to_uppercase handles non-ASCII.
        assert_eq!(author_initials("Ñandú Öztürk", "x@y.com"), "ÑÖ");
    }

    #[test]
    fn gravatar_hash_standard_example() {
        // https://docs.gravatar.com/api/avatars/hash/
        assert_eq!(
            gravatar_hash("MyEmailAddress@example.com "),
            "0bc83cb571cd1c50ba6f3e8a78ef1346"
        );
    }

    #[test]
    fn gravatar_hash_is_stable_on_case_and_whitespace() {
        let a = gravatar_hash("test@example.com");
        let b = gravatar_hash("  TEST@EXAMPLE.COM  ");
        assert_eq!(a, b);
    }

    #[test]
    fn split_message_subject_only() {
        let (s, b) = split_message("feat: add thing");
        assert_eq!(s, "feat: add thing");
        assert_eq!(b, "");
    }

    #[test]
    fn split_message_with_blank_line_separator() {
        let (s, b) = split_message("feat: add thing\n\nLong description\nSecond line");
        assert_eq!(s, "feat: add thing");
        assert_eq!(b, "Long description\nSecond line");
    }

    #[test]
    fn split_message_without_blank_line_separator() {
        // Pathological: commit without the canonical blank-line separator.
        // Body collapses to whatever comes after the first newline.
        let (s, b) = split_message("subject\nbody");
        assert_eq!(s, "subject");
        assert_eq!(b, "body");
    }

    #[test]
    fn split_message_crlf_separator() {
        let (s, b) = split_message("subject\r\n\r\nbody");
        assert_eq!(s, "subject");
        assert_eq!(b, "body");
    }

    #[test]
    fn split_message_empty_input() {
        let (s, b) = split_message("");
        assert_eq!(s, "");
        assert_eq!(b, "");
    }

    #[test]
    fn split_message_preserves_body_trailing_whitespace() {
        let (s, b) = split_message("subj\n\nbody\n");
        assert_eq!(s, "subj");
        assert_eq!(b, "body\n");
    }

    #[test]
    fn commit_default_has_empty_message_fields() {
        let c = Commit::default();
        assert_eq!(c.body, "");
        assert!(c.committer_name.is_none());
        assert!(c.committer_email.is_none());
        assert!(c.committer_date.is_none());
    }
}
