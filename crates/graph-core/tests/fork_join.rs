// SPDX-License-Identifier: AGPL-3.0-or-later

mod common;

use std::collections::HashSet;

use common::commit;
use graph_core::layout_commits;

/// A fork-and-join diamond:
///
/// ```text
///   m (parents: a, b)
///  / \
/// a   b
///  \ /
///   p
/// ```
#[test]
fn fork_join_merges_back_into_single_lane() {
    let commits = vec![
        commit("m", &["a", "b"]),
        commit("a", &["p"]),
        commit("b", &["p"]),
        commit("p", &[]),
    ];

    let rows = layout_commits(commits, 32, HashSet::new(), HashSet::new()).unwrap();

    assert_eq!(rows[0].lane, 0, "merge commit on lane 0");
    assert_eq!(rows[0].parent_lanes, vec![0, 1]);
    assert!(rows[0].is_merge);

    assert_eq!(rows[1].lane, 0, "a continues m's lane (first-parent)");
    assert_eq!(rows[1].parent_lanes, vec![0]);

    assert_eq!(rows[2].lane, 1, "b lives in the second lane");
    assert_eq!(
        rows[2].parent_lanes,
        vec![0],
        "b's parent p already lives in lane 0 — merge back"
    );

    assert_eq!(rows[3].lane, 0, "p resolves on lane 0");
    assert!(rows[3].parent_lanes.is_empty());
}
