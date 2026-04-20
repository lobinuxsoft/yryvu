// SPDX-License-Identifier: AGPL-3.0-or-later

//! Pure-Rust commit graph lane assignment for chaja.
//!
//! The [`LaneAssigner`] takes commits in reverse-chronological / reverse-topological
//! order and emits a [`GraphRow`] per commit with lane, parent-lane, and color-index
//! information ready for rendering.

mod lane;
mod row;

pub use lane::{LaneAssigner, LaneError};
pub use row::{Commit, GraphRow, RefKind, RefTag};
