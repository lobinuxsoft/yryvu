// SPDX-License-Identifier: AGPL-3.0-or-later

mod common;

use std::collections::HashSet;

use common::commit;
use graph_core::layout_commits;

/// Linear history: every row's active_lanes is exactly [0] — the trunk pipe
/// passes through every row.
#[test]
fn linear_chain_has_only_lane_zero_active() {
    let commits = vec![
        commit("c1", &["c2"]),
        commit("c2", &["c3"]),
        commit("c3", &[]),
    ];

    let rows = layout_commits(commits, 32, HashSet::new()).unwrap();

    for (i, row) in rows.iter().enumerate() {
        assert_eq!(row.active_lanes, vec![0u16], "row {i}: only lane 0 active");
    }
}

/// Fork-join diamond:
///
/// ```text
///   m (parents: a, b)   lane 0  — merge sprouts b at lane 1
///  / \
/// a   b                  both rows carry 0 AND 1
///  \ /
///   p                    lane 0 only
/// ```
#[test]
fn fork_join_has_both_lanes_active_during_fork() {
    let commits = vec![
        commit("m", &["a", "b"]),
        commit("a", &["p"]),
        commit("b", &["p"]),
        commit("p", &[]),
    ];

    let rows = layout_commits(commits, 32, HashSet::new()).unwrap();

    assert_eq!(
        rows[0].active_lanes,
        vec![0u16, 1],
        "merge M starts both lanes"
    );
    assert_eq!(
        rows[1].active_lanes,
        vec![0u16, 1],
        "A row: 0 (A) + 1 (B still pending)"
    );
    assert_eq!(
        rows[2].active_lanes,
        vec![0u16, 1],
        "B row: 0 (P reservation) + 1 (B itself)"
    );
    // GK yield semantics: B's first-parent P is already reserved at lane 0
    // (from A's pass). B at lane 1 yields, so lane 1 stays as a phantom
    // pass-through until P's row — deferred free fires here.
    assert_eq!(
        rows[3].active_lanes,
        vec![0u16, 1],
        "P row: phantom lane 1 fires its deferred free here"
    );
}

/// Octopus merge (3-way): expansion rows carry all three lanes.
#[test]
fn octopus_merge_has_three_lanes_active_through_expansion() {
    let commits = vec![
        commit("m", &["a", "b", "c"]),
        commit("a", &["z"]),
        commit("b", &["z"]),
        commit("c", &["z"]),
        commit("z", &[]),
    ];

    let rows = layout_commits(commits, 32, HashSet::new()).unwrap();

    assert_eq!(
        rows[0].active_lanes,
        vec![0u16, 1, 2],
        "octopus M: three lanes allocated"
    );
    assert_eq!(
        rows[1].active_lanes,
        vec![0u16, 1, 2],
        "A row: A at 0, B/C reservations still active at 1/2"
    );
    assert_eq!(
        rows[2].active_lanes,
        vec![0u16, 1, 2],
        "B row: A merged back to lane 0, B at 1 terminates (still listed), C still pending at 2",
    );
    assert_eq!(
        rows[3].active_lanes,
        vec![0u16, 1, 2],
        "C row: B's yielded lane 1 still phantom until Z, C at 2 terminates, Z reservation at 0",
    );
    // Z's placement fires all deferred frees (B's lane 1, C's lane 2).
    // Both are released, leaving only Z on lane 0.
    assert_eq!(
        rows[4].active_lanes,
        vec![0u16, 1, 2],
        "Z row: phantoms fire their deferred frees here"
    );
}

/// Orphan branches — each chain has its own lane; the row where lane 1 ends
/// still includes lane 1 in active_lanes (it's a terminating row).
#[test]
fn terminating_row_includes_its_own_lane() {
    let commits = vec![
        commit("a1", &["a2"]),
        commit("b1", &["b2"]),
        commit("a2", &[]),
        commit("b2", &[]),
    ];

    let rows = layout_commits(commits, 32, HashSet::new()).unwrap();

    assert_eq!(rows[0].active_lanes, vec![0u16], "a1 starts lane 0");
    assert_eq!(
        rows[1].active_lanes,
        vec![0u16, 1],
        "b1 on lane 1, lane 0 still pending a2"
    );
    assert_eq!(
        rows[2].active_lanes,
        vec![0u16, 1],
        "a2 terminates lane 0 (still listed) with lane 1 still pending b2",
    );
    assert_eq!(
        rows[3].active_lanes,
        vec![1u16],
        "b2 terminates lane 1 (still listed)"
    );
}

/// Active lanes must be sorted ascending and deduplicated across snapshots.
#[test]
fn active_lanes_are_sorted_and_deduplicated() {
    let commits = vec![
        commit("m", &["a", "b"]),
        commit("a", &["p"]),
        commit("b", &["p"]),
        commit("p", &[]),
    ];

    let rows = layout_commits(commits, 32, HashSet::new()).unwrap();

    for row in &rows {
        let mut expected = row.active_lanes.clone();
        expected.sort_unstable();
        expected.dedup();
        assert_eq!(
            row.active_lanes, expected,
            "row {}: active_lanes must be sorted + dedup",
            row.sha,
        );
    }
}
