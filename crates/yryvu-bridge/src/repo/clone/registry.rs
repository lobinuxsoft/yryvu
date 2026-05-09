// SPDX-License-Identifier: AGPL-3.0-or-later

//! Per-session cancel flags for in-flight clones.
//!
//! Mirrors the OAuth session registry shape — the frontend mints a
//! `session_id`, [`register`] returns the [`AtomicBool`] flag the
//! clone callbacks check, and [`cancel`] flips the flag for that id
//! so the running clone aborts on its next progress tick. The clone
//! command [`unregister`]s its id on completion either way.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

static CANCEL_FLAGS: LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

pub fn register(session_id: String) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    CANCEL_FLAGS
        .lock()
        .expect("clone cancel registry poisoned")
        .insert(session_id, flag.clone());
    flag
}

pub fn cancel(session_id: &str) -> bool {
    if let Some(flag) = CANCEL_FLAGS
        .lock()
        .expect("clone cancel registry poisoned")
        .get(session_id)
    {
        flag.store(true, Ordering::SeqCst);
        return true;
    }
    false
}

pub fn unregister(session_id: &str) {
    CANCEL_FLAGS
        .lock()
        .expect("clone cancel registry poisoned")
        .remove(session_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_returns_a_fresh_flag() {
        let id = "fresh-flag".to_string();
        let flag = register(id.clone());
        assert!(!flag.load(Ordering::SeqCst));
        unregister(&id);
    }

    #[test]
    fn cancel_flips_the_flag_for_known_id() {
        let id = "known-id".to_string();
        let flag = register(id.clone());
        assert!(cancel(&id));
        assert!(flag.load(Ordering::SeqCst));
        unregister(&id);
    }

    #[test]
    fn cancel_returns_false_for_unknown_id() {
        assert!(!cancel("never-registered"));
    }

    #[test]
    fn unregister_drops_the_entry() {
        let id = "drop-me".to_string();
        register(id.clone());
        unregister(&id);
        assert!(!cancel(&id));
    }
}
