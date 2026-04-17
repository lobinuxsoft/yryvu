// SPDX-License-Identifier: AGPL-3.0-or-later

mod common;

use common::commit;
use graph_core::LaneAssigner;

/// Octopus merge: one commit with three parents, all sharing a common ancestor.
#[test]
fn octopus_merge_allocates_three_lanes_then_collapses() {
    let commits = vec![
        commit("m", &["a", "b", "c"]),
        commit("a", &["z"]),
        commit("b", &["z"]),
        commit("c", &["z"]),
        commit("z", &[]),
    ];

    let mut assigner = LaneAssigner::new(32).unwrap();
    let rows: Vec<_> = commits.into_iter().map(|c| assigner.assign(c)).collect();

    assert!(rows[0].is_merge);
    assert_eq!(rows[0].parent_lanes, vec![0, 1, 2]);

    assert_eq!(rows[1].lane, 0);
    assert_eq!(rows[2].lane, 1);
    assert_eq!(rows[3].lane, 2);

    for r in &rows[1..=3] {
        assert_eq!(r.parent_lanes, vec![0], "all merge back into z's lane");
    }

    assert_eq!(rows[4].lane, 0);
    assert!(rows[4].parent_lanes.is_empty());
}
