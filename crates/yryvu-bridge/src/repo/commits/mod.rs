// SPDX-License-Identifier: AGPL-3.0-or-later

//! Commit-related ops grouped into focused submodules:
//!
//! - [`walk`] streams every reachable commit (revwalk + ref scan + topo sort).
//! - [`diff`] produces per-commit and multi-/WIP-aware combined diffs.
//! - [`details`] hydrates a single commit's full inspector metadata.
//! - [`trunk`] picks the auto-pinned branch the lane allocator favours.
//! - [`ref_scan`] (private) walks branches/tags/HEAD to seed the revwalk.

mod authors;
mod details;
mod diff;
mod ref_scan;
mod trunk;
mod walk;

pub use authors::{recent_authors, AuthorInfo, DEFAULT_LIMIT as RECENT_AUTHORS_DEFAULT_LIMIT};
pub use details::commit_details;
pub use diff::{combined_commit_diff, commit_diff};
pub use trunk::pick_pinned_head_for_path;
pub use walk::walk_commits;
