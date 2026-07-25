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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commit_default_has_empty_message_fields() {
        let c = Commit::default();
        assert_eq!(c.body, "");
        assert!(c.committer_name.is_none());
        assert!(c.committer_email.is_none());
        assert!(c.committer_date.is_none());
    }
}
