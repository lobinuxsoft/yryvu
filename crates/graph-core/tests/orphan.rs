// SPDX-License-Identifier: AGPL-3.0-or-later

mod common;

use std::collections::HashSet;

use common::commit;
use graph_core::layout_commits;

/// Two disjoint chains that never merge (unrelated histories / `git switch --orphan`).
#[test]
fn orphan_chain_claims_a_new_lane_when_first_chain_is_live() {
    let commits = vec![
        commit("a1", &["a2"]),
        commit("b1", &["b2"]),
        commit("a2", &[]),
        commit("b2", &[]),
    ];

    let rows = layout_commits(commits, 32, HashSet::new()).unwrap();

    assert_eq!(rows[0].lane, 0);
    assert_eq!(rows[1].lane, 1, "second orphan chain takes lane 1");
    assert_eq!(rows[2].lane, 0);
    assert_eq!(rows[3].lane, 1);
}

#[test]
fn orphan_chain_reclaims_retired_lane() {
    // GitKraken reuses a lane once it's been retired — the allocator is
    // leftmost-free. An orphan chain that terminates (no more parents to
    // carry the reservation) releases its column, and the next chain's
    // first commit slots right back into that column. This is what keeps
    // the graph horizontally compact even in repos with many short branches.
    let commits = vec![
        commit("a1", &["a2"]),
        commit("a2", &[]),
        commit("b1", &["b2"]),
        commit("b2", &[]),
    ];

    let rows = layout_commits(commits, 32, HashSet::new()).unwrap();

    assert_eq!(rows[0].lane, 0, "first chain starts on lane 0");
    assert_eq!(rows[1].lane, 0, "first chain continues on lane 0");
    assert_eq!(
        rows[2].lane, 0,
        "second chain reuses retired lane 0 (leftmost-free)",
    );
    assert_eq!(rows[3].lane, 0);
}
