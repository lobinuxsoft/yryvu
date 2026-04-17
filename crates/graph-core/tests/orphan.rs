// SPDX-License-Identifier: AGPL-3.0-or-later

mod common;

use common::commit;
use graph_core::LaneAssigner;

/// Two disjoint chains that never merge (unrelated histories / `git switch --orphan`).
#[test]
fn orphan_chain_claims_a_new_lane_when_first_chain_is_live() {
    let commits = vec![
        commit("a1", &["a2"]),
        commit("b1", &["b2"]),
        commit("a2", &[]),
        commit("b2", &[]),
    ];

    let mut assigner = LaneAssigner::new(32).unwrap();
    let rows: Vec<_> = commits.into_iter().map(|c| assigner.assign(c)).collect();

    assert_eq!(rows[0].lane, 0);
    assert_eq!(rows[1].lane, 1, "second orphan chain takes lane 1");
    assert_eq!(rows[2].lane, 0);
    assert_eq!(rows[3].lane, 1);

    assert_ne!(
        rows[0].color_idx, rows[1].color_idx,
        "orphan chains should (very likely) hash to distinct colors"
    );
}

#[test]
fn orphan_chain_reclaims_freed_lane_when_first_chain_completes_early() {
    let commits = vec![
        commit("a1", &["a2"]),
        commit("a2", &[]),
        commit("b1", &["b2"]),
        commit("b2", &[]),
    ];

    let mut assigner = LaneAssigner::new(32).unwrap();
    let rows: Vec<_> = commits.into_iter().map(|c| assigner.assign(c)).collect();

    assert_eq!(rows[0].lane, 0);
    assert_eq!(rows[1].lane, 0);
    assert_eq!(
        rows[2].lane, 0,
        "lane 0 is reclaimed after first chain ends"
    );
    assert_eq!(rows[3].lane, 0);
}
