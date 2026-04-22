// SPDX-License-Identifier: AGPL-3.0-or-later

mod common;

use std::collections::HashSet;

use common::commit;
use graph_core::{layout_commits, Commit, RefKind, RefTag};

fn commit_with_refs(sha: &str, parents: &[&str], refs: Vec<RefTag>) -> Commit {
    let mut c = commit(sha, parents);
    c.refs = refs;
    c
}

fn head(name: &str) -> HashSet<String> {
    HashSet::from([name.to_string()])
}

/// Linear chain: a ref on the newest commit propagates into every ancestor's
/// `child_refs.heads`, but NOT into the newest commit's own `child_refs`
/// (which only tracks strict descendants).
#[test]
fn linear_chain_propagates_branch_to_ancestors_only() {
    let commits = vec![
        commit_with_refs(
            "T",
            &["P"],
            vec![RefTag {
                name: "main".into(),
                kind: RefKind::Branch,
            }],
        ),
        commit("P", &["R"]),
        commit("R", &[]),
    ];

    let rows = layout_commits(commits, 32, HashSet::new(), HashSet::new()).unwrap();

    assert!(
        rows[0].child_refs.heads.is_empty(),
        "T is the tip — no descendants carry main",
    );
    assert_eq!(rows[1].child_refs.heads, head("main"), "P is ancestor of T");
    assert_eq!(
        rows[2].child_refs.heads,
        head("main"),
        "R is further ancestor — still carries main",
    );
}

/// Merge: two sibling branches with different refs converge at a common
/// ancestor. The common ancestor's `child_refs.heads` contains the union.
#[test]
fn merge_unions_both_branches_into_common_ancestor() {
    let commits = vec![
        commit("M", &["p1", "p2"]),
        commit_with_refs(
            "p1",
            &["C"],
            vec![RefTag {
                name: "main".into(),
                kind: RefKind::Branch,
            }],
        ),
        commit_with_refs(
            "p2",
            &["C"],
            vec![RefTag {
                name: "feature".into(),
                kind: RefKind::Branch,
            }],
        ),
        commit("C", &["R"]),
        commit("R", &[]),
    ];

    let rows = layout_commits(commits, 32, HashSet::new(), HashSet::new()).unwrap();

    assert!(
        rows[0].child_refs.heads.is_empty(),
        "M has no descendants with refs",
    );
    assert!(rows[1].child_refs.heads.is_empty(), "p1 is a tip");
    assert!(rows[2].child_refs.heads.is_empty(), "p2 is a tip");
    assert_eq!(
        rows[3].child_refs.heads,
        HashSet::from(["main".to_string(), "feature".to_string()]),
        "C is the common ancestor — carries both refs",
    );
    assert_eq!(
        rows[4].child_refs.heads,
        HashSet::from(["main".to_string(), "feature".to_string()]),
        "R further up — same union",
    );
}

/// All four ref kinds land in their correct bucket. HEAD goes to `heads`.
#[test]
fn ref_kinds_route_to_correct_buckets() {
    let commits = vec![
        commit_with_refs(
            "latest",
            &["root"],
            vec![
                RefTag {
                    name: "main".into(),
                    kind: RefKind::Branch,
                },
                RefTag {
                    name: "origin/main".into(),
                    kind: RefKind::RemoteBranch,
                },
                RefTag {
                    name: "v1.0.0".into(),
                    kind: RefKind::Tag,
                },
                RefTag {
                    name: "HEAD".into(),
                    kind: RefKind::Head,
                },
            ],
        ),
        commit("root", &[]),
    ];

    let rows = layout_commits(commits, 32, HashSet::new(), HashSet::new()).unwrap();

    // The tip row's own refs are in `refs`, not `child_refs`.
    assert!(rows[0].child_refs.heads.is_empty());
    assert!(rows[0].child_refs.remotes.is_empty());
    assert!(rows[0].child_refs.tags.is_empty());

    // `root` sees the union propagated down.
    assert_eq!(
        rows[1].child_refs.heads,
        HashSet::from(["main".to_string(), "HEAD".to_string()]),
        "Branch + Head both bucket into heads",
    );
    assert_eq!(rows[1].child_refs.remotes, head("origin/main"));
    assert_eq!(rows[1].child_refs.tags, head("v1.0.0"));
}

/// Multiple sibling tips on the same commit all propagate together.
#[test]
fn multiple_refs_on_one_row_all_propagate() {
    let commits = vec![
        commit_with_refs(
            "tip",
            &["root"],
            vec![
                RefTag {
                    name: "main".into(),
                    kind: RefKind::Branch,
                },
                RefTag {
                    name: "release/1.x".into(),
                    kind: RefKind::Branch,
                },
                RefTag {
                    name: "release-v1.0".into(),
                    kind: RefKind::Tag,
                },
            ],
        ),
        commit("root", &[]),
    ];

    let rows = layout_commits(commits, 32, HashSet::new(), HashSet::new()).unwrap();

    assert_eq!(
        rows[1].child_refs.heads,
        HashSet::from(["main".to_string(), "release/1.x".to_string()]),
    );
    assert_eq!(rows[1].child_refs.tags, head("release-v1.0"));
    assert!(rows[1].child_refs.remotes.is_empty());
}

/// Empty commit list short-circuits cleanly.
#[test]
fn empty_commits_produces_empty_rows() {
    let rows = layout_commits(Vec::new(), 32, HashSet::new(), HashSet::new()).unwrap();
    assert!(rows.is_empty());
}

/// Orphan branches (no shared history) keep their ref propagations isolated.
#[test]
fn orphan_branches_do_not_cross_contaminate() {
    let commits = vec![
        commit_with_refs(
            "a1",
            &["a2"],
            vec![RefTag {
                name: "chain-a".into(),
                kind: RefKind::Branch,
            }],
        ),
        commit_with_refs(
            "b1",
            &["b2"],
            vec![RefTag {
                name: "chain-b".into(),
                kind: RefKind::Branch,
            }],
        ),
        commit("a2", &[]),
        commit("b2", &[]),
    ];

    let rows = layout_commits(commits, 32, HashSet::new(), HashSet::new()).unwrap();

    // a2 only sees chain-a.
    assert_eq!(rows[2].child_refs.heads, head("chain-a"));
    // b2 only sees chain-b.
    assert_eq!(rows[3].child_refs.heads, head("chain-b"));
}
