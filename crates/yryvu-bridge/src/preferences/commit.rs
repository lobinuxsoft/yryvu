// SPDX-License-Identifier: AGPL-3.0-or-later

//! Commit preferences (issue #304) — port of GitKraken's
//! `CommitPreferences` tab. Four fields KEEP, validated against
//! `app/src/strings/en-us.json` (13 strings with prefix
//! `CommitPreferences-`):
//!
//! - `CommitTemplate` + `Summary` + `Description` + `UseTemplateForCommitMessages`
//!   + `SaveCommitTemplate` + `Instructions` + `CommitTemplateDocumentation`
//!   → template editor (one stored string, summary/description joined
//!   with the standard `\n\n` Git separator at apply-time)
//! - `DefaultPushAfterCommit` → push-after-commit default
//! - `DefaultSkipGitHooks` → `--no-verify` default
//! - `RemoveCommentsFromCommitMessages` → strip `#` lines before commit
//!
//! `MergeBehavior` is a sub-section header in GK and is deferred to a
//! separate audit (enum values not yet mapped). Sign-off, confirm-discard
//! and refresh-status — claimed by the original issue body — were not
//! found in `CommitPreferences-*`; sign-off is a per-invocation CLI flag
//! (`Cli-Git*-SignoffDescription`), the other two are absent entirely.
//!
//! Backend-only; the panel View lands in a follow-up sub-PR.

use serde::{Deserialize, Serialize};

/// `Preferences > Commit` panel state (issue #304). Mirrors the four GK
/// settings whose `CommitPreferences-*` strings have a matching control
/// in the panel render. Apply-time wiring (template injection into the
/// commit-panel signal, `--push` / `--no-verify` propagation to the
/// commit command, comment stripping in `create_commit`) lives in
/// follow-up issues — this struct is persistence only.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CommitPreferences {
    #[serde(default)]
    pub commit_template: Option<String>,
    #[serde(default)]
    pub use_template_for_commit_messages: bool,
    #[serde(default)]
    pub default_push_after_commit: bool,
    #[serde(default)]
    pub default_skip_git_hooks: bool,
    #[serde(default = "default_true")]
    pub remove_comments_from_commit_messages: bool,
}

impl Default for CommitPreferences {
    fn default() -> Self {
        Self {
            commit_template: None,
            use_template_for_commit_messages: false,
            default_push_after_commit: false,
            default_skip_git_hooks: false,
            remove_comments_from_commit_messages: true,
        }
    }
}

/// `remove_comments_from_commit_messages` defaults to `true` to match
/// upstream Git's `commit.cleanup = strip` baseline. A user that pastes a
/// message containing `#` lines (e.g. issue refs in some workflows) can
/// opt out from the panel; the toggle exists precisely because GK exposes
/// it as a deviation from Git's default for users who do want `#` kept.
fn default_true() -> bool {
    true
}
