// SPDX-License-Identifier: AGPL-3.0-or-later

use thiserror::Error;

/// On-disk location of the sidecar log, relative to the repo's `.git`
/// directory. Hidden by virtue of living inside `.git`, which standard
/// tooling already excludes from working-tree listings.
pub const UNDO_LOG_FILENAME: &str = "yryvu-undo.json";

/// Reflog message prefix written alongside each tracked op. Lets a human
/// running `git reflog` see yryvu's intent without having to read the
/// sidecar.
pub const REFLOG_TAG_PREFIX: &str = "yryvu:op=";

#[derive(Debug, Error)]
pub enum UndoLogError {
    #[error("undo log io error at {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("undo log parse error at {path}: {source}")]
    Parse {
        path: String,
        #[source]
        source: serde_json::Error,
    },
    #[error("system clock error: {0}")]
    Clock(#[source] std::time::SystemTimeError),
}
