// SPDX-License-Identifier: AGPL-3.0-or-later

use std::collections::HashMap;

use anyhow::{anyhow, Context};
use graph_core::{RefKind, RefTag};

use crate::backend::BackendError;

/// Resolved tracking info for a single local branch. All-zero default means
/// "no upstream configured or resolution failed" — the branch renders without
/// the upstream indicator.
#[derive(Debug, Default)]
struct UpstreamInfo {
    upstream: Option<String>,
    ahead: u32,
    behind: u32,
}

/// Resolve the upstream tracking branch + ahead/behind counts for a local
/// branch using git2. Returns `None` only on errors that prevent classifying
/// the branch (no upstream configured returns `Some(default)` with empty data).
///
/// Driven by `branch.<name>.remote` + `branch.<name>.merge` in the repo
/// config — git2's `Branch::upstream()` reads those internally. We use
/// `graph_ahead_behind` which is libgit2's optimized two-pointer walk
/// (`git_graph_ahead_behind`) to avoid loading every commit on either side.
fn resolve_upstream_tracking(
    repo: &git2::Repository,
    local_short_name: &str,
) -> Option<UpstreamInfo> {
    let local = repo
        .find_branch(local_short_name, git2::BranchType::Local)
        .ok()?;
    let upstream = local.upstream().ok()?;
    let upstream_name = upstream.name().ok().flatten()?.to_string();
    let local_oid = local.get().target()?;
    let upstream_oid = upstream.get().target()?;
    let (ahead, behind) = repo.graph_ahead_behind(local_oid, upstream_oid).ok()?;
    Some(UpstreamInfo {
        upstream: Some(upstream_name),
        ahead: ahead as u32,
        behind: behind as u32,
    })
}

/// Output of [`collect_ref_tips`]: the set of starting commits to seed the
/// revwalk with, plus a map from each tip's object id to the [`RefTag`] list
/// describing the refs that resolve to it.
///
/// The `refs_by_oid` map is drained as commits are emitted during the walk —
/// each emitted `Commit` takes its share of refs from here.
pub(super) struct RefScan {
    pub tips: Vec<gix::ObjectId>,
    pub refs_by_oid: HashMap<gix::ObjectId, Vec<RefTag>>,
}

pub(super) fn collect_ref_tips(
    repo: &gix::Repository,
    git2_repo: Option<&git2::Repository>,
) -> Result<RefScan, BackendError> {
    let platform = repo
        .references()
        .context("open references platform")
        .map_err(BackendError::Revwalk)?;

    let mut tips: Vec<gix::ObjectId> = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let mut refs_by_oid: HashMap<gix::ObjectId, Vec<RefTag>> = HashMap::new();

    for reference in platform
        .local_branches()
        .context("iterate local branches")
        .map_err(BackendError::Revwalk)?
    {
        let mut reference =
            reference.map_err(|e| BackendError::Revwalk(anyhow!("resolve local branch: {e}")))?;
        let short = reference.name().shorten().to_string();
        let id = reference
            .peel_to_id_in_place()
            .context("peel local branch tip")
            .map_err(BackendError::Revwalk)?
            .detach();
        if seen.insert(id) {
            tips.push(id);
        }
        let upstream = git2_repo
            .and_then(|r| resolve_upstream_tracking(r, &short))
            .unwrap_or_default();
        refs_by_oid.entry(id).or_default().push(RefTag {
            name: short,
            kind: RefKind::Branch,
            upstream: upstream.upstream,
            ahead: upstream.ahead,
            behind: upstream.behind,
        });
    }

    for reference in platform
        .remote_branches()
        .context("iterate remote branches")
        .map_err(BackendError::Revwalk)?
    {
        let mut reference =
            reference.map_err(|e| BackendError::Revwalk(anyhow!("resolve remote branch: {e}")))?;
        let short = reference.name().shorten().to_string();
        // Skip symbolic HEAD pointers like refs/remotes/origin/HEAD — they
        // duplicate the branch they alias.
        if short.ends_with("/HEAD") {
            continue;
        }
        let id = reference
            .peel_to_id_in_place()
            .context("peel remote branch tip")
            .map_err(BackendError::Revwalk)?
            .detach();
        if seen.insert(id) {
            tips.push(id);
        }
        refs_by_oid.entry(id).or_default().push(RefTag {
            name: short,
            kind: RefKind::RemoteBranch,
            ..Default::default()
        });
    }

    for reference in platform
        .tags()
        .context("iterate tags")
        .map_err(BackendError::Revwalk)?
    {
        let mut reference =
            reference.map_err(|e| BackendError::Revwalk(anyhow!("resolve tag: {e}")))?;
        let short = reference.name().shorten().to_string();
        let id = reference
            .peel_to_id_in_place()
            .context("peel tag tip")
            .map_err(BackendError::Revwalk)?
            .detach();
        if seen.insert(id) {
            tips.push(id);
        }
        refs_by_oid.entry(id).or_default().push(RefTag {
            name: short,
            kind: RefKind::Tag,
            ..Default::default()
        });
    }

    // HEAD as a distinct ref entry. When attached to a branch, emit HEAD at
    // the same tip so the frontend can render the checkmark / pin annotation
    // without having to cross-reference head_name separately. When detached,
    // HEAD is the only ref and becomes the sole seed.
    if let Ok(head_id) = repo.head_id() {
        let id = head_id.detach();
        refs_by_oid.entry(id).or_default().push(RefTag {
            name: "HEAD".to_string(),
            kind: RefKind::Head,
            ..Default::default()
        });
        if seen.insert(id) {
            tips.push(id);
        }
    }

    Ok(RefScan { tips, refs_by_oid })
}
