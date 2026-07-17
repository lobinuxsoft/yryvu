// SPDX-License-Identifier: AGPL-3.0-or-later

//! HEAD / branch ref manipulation shared across the rebase runtime. All
//! three helpers force-checkout, so callers must have already pre-flighted
//! a dirty working tree (see `begin_rebase`).

use git2::{Commit, Oid, Repository};

use crate::backend::BackendError;

use super::super::super::common::git2_err;

pub(super) fn head_commit(repo: &Repository) -> Result<Commit<'_>, BackendError> {
    repo.head()
        .and_then(|h| h.peel_to_commit())
        .map_err(git2_err)
}

pub(super) fn detach_to(repo: &Repository, oid: Oid, msg: &str) -> Result<(), BackendError> {
    repo.set_head_detached(oid).map_err(git2_err)?;
    repo.reference("HEAD", oid, true, msg).map_err(git2_err)?;
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force();
    repo.checkout_head(Some(&mut checkout)).map_err(git2_err)?;
    Ok(())
}

pub(super) fn move_branch_to(
    repo: &Repository,
    branch_full: &str,
    oid: Oid,
    msg: &str,
) -> Result<(), BackendError> {
    repo.reference(branch_full, oid, true, msg)
        .map_err(git2_err)?;
    repo.set_head(branch_full).map_err(git2_err)?;
    let mut checkout = git2::build::CheckoutBuilder::new();
    checkout.force();
    repo.checkout_head(Some(&mut checkout)).map_err(git2_err)?;
    Ok(())
}
