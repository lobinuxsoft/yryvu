// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

/// Pick an automatic pin target for the graph trunk.
///
/// GitKraken pins the currently-checked-out branch as the trunk spine —
/// that's the commit line the user is actively working on, and the one
/// that stays column 0 across the whole graph. Fall through only when
/// the repo has no local HEAD attached (detached / fresh clone).
///
/// Resolution order:
///
/// 1. **Local `HEAD` if attached** to a named branch — mirrors GK's
///    behaviour of pinning the current branch.
/// 2. `refs/remotes/origin/HEAD` peeled — fallback for detached HEAD,
///    uses the remote's declared default branch.
/// 3. First local branch matching `main`, `master`, `development`, or
///    `trunk` — last-ditch fallback when neither HEAD source is usable.
///
/// Previously step 1 was the remote HEAD, which broke for repos where
/// `origin/HEAD` points to a stale or empty branch (e.g. `main` that
/// still holds only the initial commit while all work landed on
/// `development`). The pinned set would end up as a single-commit chain
/// and the actual development spine would render on lane 1+ instead of
/// lane 0.
///
/// Returns `None` when none of the candidates resolve — in that case
/// the caller should feed an empty `HashSet` into the lane allocator,
/// which collapses to pure leftmost-free.
pub fn pick_pinned_head_for_path(repo_path: &Path) -> Option<String> {
    let repo = super::super::common::open_repo(repo_path).ok()?;
    pick_pinned_head(&repo)
}

pub fn pick_pinned_head(repo: &gix::Repository) -> Option<String> {
    if let Ok(Some(head_name)) = repo.head_name() {
        let name = head_name.as_bstr().to_string();
        if let Some(id) = peel_ref(repo, &name) {
            return Some(id);
        }
    }

    if let Some(id) = peel_ref(repo, "refs/remotes/origin/HEAD") {
        return Some(id);
    }

    const TRUNK_CANDIDATES: &[&str] = &[
        "refs/heads/main",
        "refs/heads/master",
        "refs/heads/development",
        "refs/heads/trunk",
    ];
    for candidate in TRUNK_CANDIDATES {
        if let Some(id) = peel_ref(repo, candidate) {
            return Some(id);
        }
    }

    None
}

fn peel_ref(repo: &gix::Repository, full_name: &str) -> Option<String> {
    let mut reference = repo.find_reference(full_name).ok()?;
    let id = reference.peel_to_id_in_place().ok()?.detach();
    Some(id.to_string())
}
