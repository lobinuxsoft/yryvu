// SPDX-License-Identifier: AGPL-3.0-or-later

use std::collections::HashSet;

#[cfg(feature = "serde")]
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub enum RefKind {
    Branch,
    RemoteBranch,
    Tag,
    Head,
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

#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct RefTag {
    pub name: String,
    pub kind: RefKind,
}

/// Input commit — caller is responsible for providing commits in reverse-topological order
/// (children before parents).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Commit {
    pub sha: String,
    pub parents: Vec<String>,
    pub summary: String,
    pub author_name: String,
    pub author_email: String,
    pub author_date: i64,
    pub refs: Vec<RefTag>,
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
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(Serialize, Deserialize))]
pub struct GraphRow {
    pub sha: String,
    pub short_sha: String,
    pub summary: String,
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
    pub lane: u16,
    pub parent_lanes: Vec<u16>,
    pub parent_shas: Vec<String>,
    pub color_idx: u16,
    pub refs: Vec<RefTag>,
    pub is_merge: bool,
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
}
