// SPDX-License-Identifier: AGPL-3.0-or-later

mod common;

use std::collections::HashSet;

use common::commit;
use graph_core::layout_commits;

/// Column stealing — M's extra parent `b` initially lands on column 1, but
/// later `c` (processed from column 0) steals `p` leftward so the chain
/// collapses to a single lane at the bottom.
///
/// ```text
///   m  (parents: a, b)
///  / \
/// a   b
/// |   |
/// c   .
///  \ /
///   p
/// ```
///
/// Walk order: m, a, b, c, p. When c processes its first-parent p:
/// - p already has a reservation at column 1 (from b).
/// - c lives at column 0, so existing_col (1) > current_lane (0).
/// - p has no merge child in the current walk (b was M's second parent, not
///   p itself), so the steal proceeds — p's reservation moves to column 0
///   and column 1 is queued for release at p.
#[test]
fn parent_is_stolen_leftward_when_no_merge_child_claims_it() {
    let commits = vec![
        commit("m", &["a", "b"]),
        commit("a", &["c"]),
        commit("b", &["p"]),
        commit("c", &["p"]),
        commit("p", &[]),
    ];

    let rows = layout_commits(commits, 32, HashSet::new(), HashSet::new()).unwrap();

    assert_eq!(rows[0].lane, 0, "m on lane 0");
    assert_eq!(rows[0].parent_lanes, vec![0, 1]);
    assert_eq!(rows[1].lane, 0, "a continues m's lane");
    assert_eq!(rows[2].lane, 1, "b on the second lane");
    assert_eq!(rows[3].lane, 0, "c inherits a's lane from its reservation");
    assert_eq!(
        rows[4].lane, 0,
        "p stolen to lane 0 by c — trunk collapses leftward",
    );
    assert_eq!(
        rows[2].parent_lanes,
        vec![0],
        "b's edge lands at p's final column after steal",
    );
}

/// When the parent already has a merge child claiming it, stealing is
/// blocked. The current commit's column is queued for deferred release at
/// the parent and stays occupied as a phantom to prevent unrelated commits
/// from crossing the implied edge.
///
/// ```text
///   m1 (parents: x, p)    <-- merge: p gets a merge child here
///  / \
/// x   .
/// |
/// o  (orphan, unrelated)
/// |
/// .   <-- p shared bottom
/// ```
///
/// Walk order: m1, x, o, p. When x processes first-parent p:
/// - p reserved at column 1, x at column 0, existing_col > current_lane.
/// - p has a merge child (m1), so steal is blocked.
/// - Column 0 is queued for release when p arrives — during that wait it
///   stays marked "used" as a phantom, so the orphan o is forced to column
///   2 instead of claiming the visually-crossing column 0.
#[test]
fn steal_is_blocked_when_parent_already_has_merge_child() {
    let commits = vec![
        commit("m1", &["x", "p"]),
        commit("x", &["p"]),
        commit("o", &[]),
        commit("p", &[]),
    ];

    let rows = layout_commits(commits, 32, HashSet::new(), HashSet::new()).unwrap();

    assert_eq!(rows[0].lane, 0, "m1 on lane 0");
    assert_eq!(rows[0].parent_lanes, vec![0, 1]);
    assert_eq!(rows[1].lane, 0, "x continues m1's lane");
    assert_eq!(
        rows[2].lane, 2,
        "orphan pushed to lane 2 — lane 0 phantom-held by x's deferred free, lane 1 held for p",
    );
    assert_eq!(
        rows[3].lane, 1,
        "p keeps its original reservation — no steal happened",
    );
    assert_eq!(
        rows[1].parent_lanes,
        vec![1],
        "x's edge crosses rightward to reach p",
    );
}
