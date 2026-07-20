// SPDX-License-Identifier: AGPL-3.0-or-later

//! Persistence of the interactive-rebase state sidecar
//! (`.git/yryvu-rebase-state.json`), kept separate from git's own
//! `.git/rebase-merge/` so the two never collide.

use std::path::PathBuf;

use anyhow::anyhow;
use git2::Repository;

use crate::backend::BackendError;

use super::plan::RebaseState;

const STATE_FILE: &str = "yryvu-rebase-state.json";

fn state_path(repo: &Repository) -> PathBuf {
    repo.path().join(STATE_FILE)
}

pub(super) fn load_state(repo: &Repository) -> Result<Option<RebaseState>, BackendError> {
    let path = state_path(repo);
    if !path.exists() {
        return Ok(None);
    }
    let bytes = std::fs::read(&path).map_err(|e| BackendError::Git(anyhow!(e)))?;
    let state: RebaseState =
        serde_json::from_slice(&bytes).map_err(|e| BackendError::Git(anyhow!(e)))?;
    Ok(Some(state))
}

pub(super) fn save_state(repo: &Repository, state: &RebaseState) -> Result<(), BackendError> {
    let path = state_path(repo);
    let bytes = serde_json::to_vec_pretty(state).map_err(|e| BackendError::Git(anyhow!(e)))?;
    std::fs::write(&path, bytes).map_err(|e| BackendError::Git(anyhow!(e)))?;
    Ok(())
}

pub(super) fn clear_state(repo: &Repository) -> Result<(), BackendError> {
    let path = state_path(repo);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| BackendError::Git(anyhow!(e)))?;
    }
    Ok(())
}
