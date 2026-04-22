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

    let rows = layout_commits(commits, 32, HashSet::new(), HashSet::new()).unwrap();

    assert_eq!(rows[0].lane, 0);
    assert_eq!(rows[1].lane, 1, "second orphan chain takes lane 1");
    assert_eq!(rows[2].lane, 0);
    assert_eq!(rows[3].lane, 1);
}

#[test]
fn orphan_chain_does_not_reclaim_retired_lane() {
    // GitKraken never reuses a lane once it's been retired — each new chain
    // gets a fresh column even if earlier columns are empty. This produces
    // the "branches keep their column for life" visual that makes the graph
    // readable at a glance.
    let commits = vec![
        commit("a1", &["a2"]),
        commit("a2", &[]),
        commit("b1", &["b2"]),
        commit("b2", &[]),
    ];

    let rows = layout_commits(commits, 32, HashSet::new(), HashSet::new()).unwrap();

    assert_eq!(rows[0].lane, 0, "first chain starts on lane 0");
    assert_eq!(rows[1].lane, 0, "first chain continues on lane 0");
    assert_eq!(
        rows[2].lane, 1,
        "second chain gets a fresh lane 1 even though lane 0 is now empty",
    );
    assert_eq!(rows[3].lane, 1);
}
