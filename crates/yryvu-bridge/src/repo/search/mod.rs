// SPDX-License-Identifier: AGPL-3.0-or-later

//! Fuzzy finder backend (issue #14). VS Code-style Cmd/Ctrl-K palette
//! that fans out across five modes: commits / files / branches / tags
//! / stashes. Pure-Rust matcher via `nucleo-matcher` (Helix's), no
//! allocation in the hot scoring path.
//!
//! Architecture: SoA-by-mode index cached per repo. `build_index` is
//! called from the IPC layer on palette open + on refs/working-tree
//! refresh hooks. `search` reads the cache and never touches disk —
//! every name/summary/path/oid lives in the index already.

mod index;
mod query;

#[cfg(test)]
mod tests;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::backend::BackendError;

pub use index::{build_index, IndexCounts, SearchIndex};
pub use query::{search, SearchHit};

/// Which corpus the palette is searching.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum SearchMode {
    Commits,
    Files,
    Branches,
    Tags,
    Stashes,
}

/// Global per-process cache of indexed repos. CPU-only coordination,
/// so a Mutex<HashMap> is the right primitive (the rust-DOD rule bans
/// HashMap in hot paths *adjacent to GPU* — this is plain CPU streaming).
static INDEX_CACHE: Mutex<Option<HashMap<PathBuf, SearchIndex>>> = Mutex::new(None);

pub(crate) fn cache_with<F, R>(repo_path: &Path, f: F) -> Result<R, BackendError>
where
    F: FnOnce(&SearchIndex) -> Result<R, BackendError>,
{
    let key = repo_path.to_path_buf();
    let mut guard = INDEX_CACHE
        .lock()
        .map_err(|_| BackendError::Git(anyhow::anyhow!("search cache poisoned")))?;
    let map = guard.get_or_insert_with(HashMap::new);
    if !map.contains_key(&key) {
        map.insert(key.clone(), index::build_index_inner(repo_path)?);
    }
    let idx = map
        .get(&key)
        .ok_or_else(|| BackendError::Git(anyhow::anyhow!("index missing after insert")))?;
    f(idx)
}

pub(crate) fn cache_insert(repo_path: &Path, index: SearchIndex) {
    let key = repo_path.to_path_buf();
    if let Ok(mut guard) = INDEX_CACHE.lock() {
        guard.get_or_insert_with(HashMap::new).insert(key, index);
    }
}

#[cfg(test)]
pub(crate) fn cache_reset() {
    if let Ok(mut guard) = INDEX_CACHE.lock() {
        *guard = None;
    }
}
