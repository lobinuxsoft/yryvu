// SPDX-License-Identifier: AGPL-3.0-or-later

//! Issue tracker preferences (issue #306).
//!
//! Holds the **global default** for issue tracker URL pattern + the
//! toggles that drive linkify rendering in commit messages. Per-repo
//! overrides do NOT live here — they live in the repo's own
//! `.git/config` under `[yryvu] issueTrackerUrl`, queried via
//! [`crate::repo::config_custom`]. This split mirrors GK's model:
//! global default plus a per-repo escape hatch that doesn't pollute
//! the user-wide JSON.
//!
//! The pattern is a template string containing `{owner}`, `{repo}`, and
//! `{id}` placeholders, e.g. `https://github.com/{owner}/{repo}/issues/{id}`.
//! Auto-detect (when enabled) resolves the pattern from the repo's
//! `origin` remote URL via [`crate::repo::hosting::provider_issue_url_pattern`].

use serde::{Deserialize, Serialize};

/// `Preferences > Issue Tracker` panel state (issue #306).
///
/// Three fields:
///
/// - `default_url_pattern` — fallback template when auto-detect can't
///   classify the remote (self-hosted with no brand marker in hostname)
///   AND no per-repo override is set. `None` means "no fallback — show
///   issue refs as plain text when nothing else matches".
/// - `linkify_in_commits` — toggles the rendering pass that converts
///   `#123` refs in commit messages, branch names, and PR descriptions
///   into hyperlinks. Default `true` because the feature is mostly
///   harmless when no pattern resolves (refs stay plain text).
/// - `auto_detect_provider` — when `true`, the resolver tries to
///   classify `origin`'s URL before falling back to `default_url_pattern`.
///   Users who deliberately point to a non-standard tracker can disable
///   this to force their override / default.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IssueTrackerPreferences {
    #[serde(default)]
    pub default_url_pattern: Option<String>,
    #[serde(default = "default_true")]
    pub linkify_in_commits: bool,
    #[serde(default = "default_true")]
    pub auto_detect_provider: bool,
}

impl Default for IssueTrackerPreferences {
    fn default() -> Self {
        Self {
            default_url_pattern: None,
            linkify_in_commits: true,
            auto_detect_provider: true,
        }
    }
}

fn default_true() -> bool {
    true
}
