// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

const REFLOG_CACHE_CAP: usize = 32;

#[derive(Debug)]
pub(super) struct ReflogCache {
    entries: Mutex<Vec<CacheRow>>,
    cap: usize,
}

#[derive(Debug, Clone)]
struct CacheRow {
    key: (PathBuf, String),
    mtime: Option<SystemTime>,
    base: Option<String>,
}

impl ReflogCache {
    const fn new(cap: usize) -> Self {
        Self {
            entries: Mutex::new(Vec::new()),
            cap,
        }
    }

    pub(super) fn get(
        &self,
        key: &(PathBuf, String),
        mtime: Option<SystemTime>,
    ) -> Option<Option<String>> {
        let mut entries = self.entries.lock().ok()?;
        let idx = entries.iter().position(|row| &row.key == key)?;
        if entries[idx].mtime != mtime {
            entries.remove(idx);
            return None;
        }
        let row = entries.remove(idx);
        let base = row.base.clone();
        entries.push(row);
        Some(base)
    }

    pub(super) fn put(
        &self,
        key: (PathBuf, String),
        mtime: Option<SystemTime>,
        base: Option<String>,
    ) {
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };
        if let Some(idx) = entries.iter().position(|row| row.key == key) {
            entries.remove(idx);
        }
        if entries.len() >= self.cap {
            entries.remove(0);
        }
        entries.push(CacheRow { key, mtime, base });
    }

    #[cfg(test)]
    fn clear(&self) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.clear();
        }
    }
}

pub(super) fn cache() -> &'static ReflogCache {
    static CACHE: OnceLock<ReflogCache> = OnceLock::new();
    CACHE.get_or_init(|| ReflogCache::new(REFLOG_CACHE_CAP))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_lru_evicts_oldest_when_full() {
        let cache = ReflogCache::new(2);
        let key_a: (PathBuf, String) = (PathBuf::from("/a"), "refs/heads/a".into());
        let key_b: (PathBuf, String) = (PathBuf::from("/b"), "refs/heads/b".into());
        let key_c: (PathBuf, String) = (PathBuf::from("/c"), "refs/heads/c".into());

        cache.put(key_a.clone(), None, Some("base_a".into()));
        cache.put(key_b.clone(), None, Some("base_b".into()));
        cache.put(key_c.clone(), None, Some("base_c".into()));

        assert!(cache.get(&key_a, None).is_none(), "oldest evicted");
        assert_eq!(cache.get(&key_b, None), Some(Some("base_b".into())));
        assert_eq!(cache.get(&key_c, None), Some(Some("base_c".into())));
    }

    #[test]
    fn cache_promotes_on_hit() {
        let cache = ReflogCache::new(2);
        let key_a: (PathBuf, String) = (PathBuf::from("/a"), "refs/heads/a".into());
        let key_b: (PathBuf, String) = (PathBuf::from("/b"), "refs/heads/b".into());
        let key_c: (PathBuf, String) = (PathBuf::from("/c"), "refs/heads/c".into());

        cache.put(key_a.clone(), None, Some("base_a".into()));
        cache.put(key_b.clone(), None, Some("base_b".into()));
        cache.get(&key_a, None);
        cache.put(key_c.clone(), None, Some("base_c".into()));

        assert_eq!(cache.get(&key_a, None), Some(Some("base_a".into())));
        assert!(
            cache.get(&key_b, None).is_none(),
            "B was LRU and got evicted"
        );
        cache.clear();
    }

    #[test]
    fn cache_invalidates_on_mtime_change() {
        let cache = ReflogCache::new(2);
        let key: (PathBuf, String) = (PathBuf::from("/a"), "refs/heads/a".into());
        let t0 = SystemTime::UNIX_EPOCH;
        let t1 = SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(1);

        cache.put(key.clone(), Some(t0), Some("old".into()));
        assert!(cache.get(&key, Some(t1)).is_none());
        cache.put(key.clone(), Some(t1), Some("new".into()));
        assert_eq!(cache.get(&key, Some(t1)), Some(Some("new".into())));
    }
}
