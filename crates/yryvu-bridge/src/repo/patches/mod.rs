// SPDX-License-Identifier: AGPL-3.0-or-later

//! Patch (mbox) codec. `format_patch` emits a `git format-patch -1` file;
//! `apply_patch` is its inverse (`git am` equivalent, issue #75). Both are
//! git2-based — `Diff::from_buffer` + `Repository::apply` have no gix
//! equivalent.

mod apply;
mod format;

pub use apply::apply_patch;
pub use format::format_patch;
