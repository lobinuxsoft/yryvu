// SPDX-License-Identifier: AGPL-3.0-or-later

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
}
