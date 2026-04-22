// SPDX-License-Identifier: AGPL-3.0-or-later

mod common;

use std::collections::HashSet;

use common::commit;
use graph_core::{build_pinned_set, layout_commits};

/// Orphan branch loads first but must NOT steal column 0 — the pinned chain
/// that loads later owns it.
#[test]
fn pinned_chain_reserves_column_zero_even_when_loaded_after_other_branches() {
    let commits = vec![
        commit("x", &[]),
        commit("m", &["n"]),
        commit("n", &["o"]),
        commit("o", &[]),
    ];

    let pinned = build_pinned_set(&commits, Some("m"));
    assert_eq!(
        pinned,
        HashSet::from(["m".into(), "n".into(), "o".into()]),
    );

    let rows = layout_commits(commits, 32, pinned, HashSet::new()).unwrap();

    assert_eq!(rows[0].lane, 1, "orphan loaded first pushed out of column 0");
    assert_eq!(rows[1].lane, 0, "pinned tip lands on column 0");
    assert_eq!(rows[2].lane, 0, "pinned first-parent continues on column 0");
    assert_eq!(rows[3].lane, 0, "pinned root still on column 0");
}

/// Without a pinned set, the unreserved-commit path still uses the
/// never-reuse allocator — the orphan leaf takes lane 0 and retires it;
/// the next chain gets a fresh lane 1 even though lane 0 is now empty.
#[test]
fn unpinned_walk_allocates_fresh_lanes_without_reuse() {
    let commits = vec![
        commit("x", &[]),
        commit("m", &["n"]),
        commit("n", &["o"]),
        commit("o", &[]),
    ];

    let rows = layout_commits(commits, 32, HashSet::new(), HashSet::new()).unwrap();

    assert_eq!(rows[0].lane, 0, "orphan x takes lane 0 and retires it");
    assert_eq!(
        rows[1].lane, 1,
        "m starts a fresh chain on lane 1 — no reuse of retired lane 0",
    );
    assert_eq!(rows[2].lane, 1, "n inherits m's lane");
    assert_eq!(rows[3].lane, 1, "o inherits n's lane");
}

/// A merge whose *extra* parent is on the pinned chain routes the extra
/// parent to column 0 instead of allocating a fresh lane.
#[test]
fn merge_extra_parent_on_pinned_chain_lands_in_column_zero() {
    let commits = vec![
        commit("m", &["a", "t"]),
        commit("a", &["b"]),
        commit("b", &["t"]),
        commit("t", &["u"]),
        commit("u", &[]),
    ];

    let pinned = build_pinned_set(&commits, Some("t"));
    assert_eq!(pinned, HashSet::from(["t".into(), "u".into()]));

    let rows = layout_commits(commits, 32, pinned, HashSet::new()).unwrap();

    assert_eq!(rows[0].lane, 1, "merge not on trunk — lane 1 with pin active");
    assert_eq!(
        rows[0].parent_lanes,
        vec![1, 0],
        "first-parent continues, extra parent t goes straight to column 0",
    );
    assert_eq!(rows[3].lane, 0, "pinned t on column 0");
    assert_eq!(rows[4].lane, 0, "pinned u on column 0");
}

/// Supplying a tip sha that isn't in the commit slice yields an empty pinned
/// set — the graph silently falls back to leftmost-free.
#[test]
fn missing_pinned_tip_yields_empty_set() {
    let commits = vec![commit("a", &["b"]), commit("b", &[])];
    let pinned = build_pinned_set(&commits, Some("does-not-exist"));
    assert!(pinned.is_empty());
}
