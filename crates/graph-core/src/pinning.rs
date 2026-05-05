// SPDX-License-Identifier: AGPL-3.0-or-later

use std::collections::{HashMap, HashSet};

use crate::row::Commit;

/// Walk the first-parent chain of the pinned branch and return the set of
/// shas on that chain.
///
/// The caller supplies:
///
/// - `commits` — the topologically ordered commit slice (the same slice that
///   will be fed into [`crate::layout_commits`]).
/// - `pinned_tip` — the sha of the tip of the pinned branch. `None` (no
///   pinned branch) yields an empty set, which disables trunk pinning.
///
/// The walk terminates when it reaches a commit whose first-parent is not
/// in the slice (end of history, or the chain leaves the loaded subset) or
/// when the tip itself is missing from `commits`.
pub fn build_pinned_set(commits: &[Commit], pinned_tip: Option<&str>) -> HashSet<String> {
    let Some(tip) = pinned_tip else {
        return HashSet::new();
    };

    let by_sha: HashMap<&str, &Commit> = commits.iter().map(|c| (c.sha.as_str(), c)).collect();
    if !by_sha.contains_key(tip) {
        return HashSet::new();
    }

    let mut out = HashSet::new();
    let mut cursor = Some(tip.to_string());
    while let Some(sha) = cursor {
        if !out.insert(sha.clone()) {
            // Cycle guard — shouldn't happen in a real DAG, but defensive.
            break;
        }
        cursor = by_sha
            .get(sha.as_str())
            .and_then(|c| c.parents.first().cloned());
    }
    out
}
