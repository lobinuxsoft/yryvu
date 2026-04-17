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
    pub color_idx: u16,
    pub refs: Vec<RefTag>,
    pub is_merge: bool,
}
