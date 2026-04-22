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
    pub author: String,
    pub author_date: i64,
    pub refs: Vec<RefTag>,
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
    pub author: String,
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
