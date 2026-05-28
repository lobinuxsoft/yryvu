// SPDX-License-Identifier: AGPL-3.0-or-later

//! Pure-Rust commit graph lane assignment for yryvu.
//!
//! The public entry point is [`layout_commits`], which takes a topologically
//! ordered commit slice (children before parents) together with an optional
//! set of pinned shas and emits one [`GraphRow`] per commit ready for
//! rendering.

mod child_refs;
mod lane;
mod pinning;
mod row;

use std::collections::HashSet;

pub use child_refs::populate_child_refs;
pub use lane::{layout_commits, LaneAssigner, LaneError};
pub use pinning::build_pinned_set;
pub use row::{
    author_initials, gravatar_hash, split_message, ChildRefs, Commit, GraphRow, NodeType, RefKind,
    RefTag,
};

/// Convenience alias for the pinned-sha set handed to [`layout_commits`].
pub type PinnedShas = HashSet<String>;
