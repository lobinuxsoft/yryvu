// SPDX-License-Identifier: AGPL-3.0-or-later

use std::collections::HashMap;

use crate::row::{GraphRow, RefKind};

/// Populate `GraphRow::child_refs` for every row via a single bottom-up pass.
///
/// Matches GitKraken's `childRefs` precomputation documented in
/// `docs/research/gitkraken-graph/08-hover-dim.md`:
///
/// ```text
/// for row in topo_rows:
///   for parent_sha in row.parents:
///     parent.child_refs.heads   |= row.own_heads   | row.child_refs.heads
///     parent.child_refs.remotes |= row.own_remotes | row.child_refs.remotes
///     parent.child_refs.tags    |= row.own_tags    | row.child_refs.tags
/// ```
///
/// `rows` must be in children-first topological order (newer commits before
/// their parents) — the same order produced by [`crate::layout_commits`]. An
/// out-of-order slice produces incorrect results without panicking.
///
/// Complexity: `O(N + E)` where `N = rows.len()` and `E` is the total number
/// of parent edges. Memory: sets grow with the ref count on each commit's
/// descendant fan-in — typically a few entries per row.
pub fn populate_child_refs(rows: &mut [GraphRow]) {
    if rows.is_empty() {
        return;
    }

    let sha_to_index: HashMap<String, usize> = rows
        .iter()
        .enumerate()
        .map(|(i, r)| (r.sha.clone(), i))
        .collect();

    for i in 0..rows.len() {
        let parent_indices: Vec<usize> = rows[i]
            .parent_shas
            .iter()
            .filter_map(|sha| sha_to_index.get(sha).copied())
            .filter(|&idx| idx != i)
            .collect();

        if parent_indices.is_empty() {
            continue;
        }

        let (own_heads, own_remotes, own_tags) = classify_own_refs(&rows[i]);

        let mut prop_heads: Vec<String> =
            Vec::with_capacity(own_heads.len() + rows[i].child_refs.heads.len());
        prop_heads.extend(own_heads);
        prop_heads.extend(rows[i].child_refs.heads.iter().cloned());

        let mut prop_remotes: Vec<String> =
            Vec::with_capacity(own_remotes.len() + rows[i].child_refs.remotes.len());
        prop_remotes.extend(own_remotes);
        prop_remotes.extend(rows[i].child_refs.remotes.iter().cloned());

        let mut prop_tags: Vec<String> =
            Vec::with_capacity(own_tags.len() + rows[i].child_refs.tags.len());
        prop_tags.extend(own_tags);
        prop_tags.extend(rows[i].child_refs.tags.iter().cloned());

        for p_idx in parent_indices {
            let parent = &mut rows[p_idx];
            for s in &prop_heads {
                parent.child_refs.heads.insert(s.clone());
            }
            for s in &prop_remotes {
                parent.child_refs.remotes.insert(s.clone());
            }
            for s in &prop_tags {
                parent.child_refs.tags.insert(s.clone());
            }
        }
    }
}

fn classify_own_refs(row: &GraphRow) -> (Vec<String>, Vec<String>, Vec<String>) {
    let mut heads = Vec::new();
    let mut remotes = Vec::new();
    let mut tags = Vec::new();
    for r in &row.refs {
        match r.kind {
            RefKind::Branch | RefKind::Head => heads.push(r.name.clone()),
            RefKind::RemoteBranch => remotes.push(r.name.clone()),
            RefKind::Tag => tags.push(r.name.clone()),
        }
    }
    (heads, remotes, tags)
}
