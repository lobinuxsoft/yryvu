// SPDX-License-Identifier: AGPL-3.0-or-later

mod common;

use common::commit;
use graph_core::LaneAssigner;

#[test]
fn linear_history_stays_on_lane_zero() {
    let commits = vec![commit("a", &["b"]), commit("b", &["c"]), commit("c", &[])];

    let mut assigner = LaneAssigner::new(32).unwrap();
    let rows: Vec<_> = commits.into_iter().map(|c| assigner.assign(c)).collect();

    assert_eq!(rows[0].lane, 0);
    assert_eq!(rows[0].parent_lanes, vec![0]);
    assert!(!rows[0].is_merge);

    assert_eq!(rows[1].lane, 0);
    assert_eq!(rows[1].parent_lanes, vec![0]);

    assert_eq!(rows[2].lane, 0);
    assert!(rows[2].parent_lanes.is_empty());

    let color = rows[0].color_idx;
    assert!(rows.iter().all(|r| r.color_idx == color));
}
