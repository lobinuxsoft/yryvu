// SPDX-License-Identifier: AGPL-3.0-or-later

//! Plan validation and the refusal to start over a dirty working tree.

use std::fs;

use super::*;

#[test]
fn validate_rejects_leading_squash() {
    let (_d, path, base, [a, _b, _c]) = three_commit_topic();
    let plan = RebasePlan {
        onto: base.to_string(),
        steps: vec![plan_step(a, RebaseAction::Squash)],
    };
    let err = begin_rebase(&path, plan).unwrap_err();
    assert!(format!("{err}").contains("squash"));
}

/// A rebase must refuse to start over a dirty working tree, the way git
/// itself does (`cannot rebase: You have unstaged changes`). `detach_to`
/// force-checks-out, so without this guard the uncommitted content is
/// overwritten and is recoverable from nowhere — it never became a git
/// object.
#[test]
fn begin_rebase_refuses_dirty_working_tree() {
    let (_d, path, base, [a, b, c]) = three_commit_topic();
    fs::write(path.join("scratch.txt"), "uncommitted work\n").unwrap();

    let plan = RebasePlan {
        onto: base.to_string(),
        steps: vec![
            plan_step(a, RebaseAction::Pick),
            plan_step(b, RebaseAction::Pick),
            plan_step(c, RebaseAction::Pick),
        ],
    };
    let err = begin_rebase(&path, plan).unwrap_err();

    assert!(
        matches!(err, BackendError::WorkingTreeDirty),
        "expected WorkingTreeDirty, got {err:?}"
    );
    assert_eq!(
        fs::read_to_string(path.join("scratch.txt")).unwrap(),
        "uncommitted work\n",
        "uncommitted work was destroyed"
    );
}

/// A tracked file edited but not committed must survive too — this is the
/// case `detach_to`'s force checkout overwrites via UPDATE_BLOB.
#[test]
fn begin_rebase_refuses_dirty_tracked_file() {
    let (_d, path, base, [a, b, c]) = three_commit_topic();
    fs::write(path.join("a.txt"), "EDITED, NOT COMMITTED\n").unwrap();

    let plan = RebasePlan {
        onto: base.to_string(),
        steps: vec![
            plan_step(a, RebaseAction::Pick),
            plan_step(b, RebaseAction::Pick),
            plan_step(c, RebaseAction::Pick),
        ],
    };
    let err = begin_rebase(&path, plan).unwrap_err();

    assert!(
        matches!(err, BackendError::WorkingTreeDirty),
        "expected WorkingTreeDirty, got {err:?}"
    );
    assert_eq!(
        fs::read_to_string(path.join("a.txt")).unwrap(),
        "EDITED, NOT COMMITTED\n",
        "uncommitted edit to a tracked file was destroyed"
    );
}
