// SPDX-License-Identifier: AGPL-3.0-or-later

use serde::{Deserialize, Serialize};

use crate::backend::ResetMode;

use super::errors::REFLOG_TAG_PREFIX;

/// serde default for `StashPush::include_untracked`: the pre-flags stash
/// path always passed `include_untracked = true`, so old logs decode to
/// the behaviour they were written under.
fn default_include_untracked() -> bool {
    true
}

/// Operation archetypes yryvu knows how to invert. Each variant carries
/// the minimum metadata sub-PR 2's inverse builder needs — pre-SHA for
/// resets, post-SHA for "undo this commit", stash refs, etc. Anything
/// beyond that gets recovered from `git2` at undo-time.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum OpKind {
    /// New commit on the current branch. `parent_sha` is `None` for root
    /// commits — those can't be undone via `reset --soft HEAD~1` (no
    /// parent to step back to) and the inverse builder treats them as
    /// untrackable.
    Commit {
        sha: String,
        parent_sha: Option<String>,
    },
    /// HEAD's commit replaced by an amended one. Reflog still references
    /// `old_sha` for ~90 days; we mirror it in the sidecar so the undo
    /// builder can fall back to the sidecar after GC.
    Amend { old_sha: String, new_sha: String },
    /// Branch checkout — switches HEAD to a different ref. `from` and
    /// `to` are branch short names (without `refs/heads/`).
    CheckoutBranch { from: String, to: String },
    /// Detached-HEAD checkout. `from` is the previous ref name (or the
    /// previous detached SHA) and `to_sha` is the commit checked out.
    CheckoutCommit { from: String, to_sha: String },
    /// `reset --(soft|mixed|hard)` to a target commit. `from_sha` is
    /// HEAD before the reset, `to_sha` is HEAD after.
    Reset {
        mode: ResetMode,
        from_sha: String,
        to_sha: String,
    },
    /// Cherry-pick that produced a new commit. `applied_sha` is the
    /// source; `new_sha` is the cherry-pick result on HEAD.
    CherryPick {
        applied_sha: String,
        new_sha: String,
    },
    /// Revert that produced a new commit. `reverted_sha` is the source;
    /// `new_sha` is the revert commit on HEAD.
    Revert {
        reverted_sha: String,
        new_sha: String,
    },
    /// Merge of `source` into the current branch. `pre_merge_sha` is
    /// HEAD before the merge (the equivalent of `ORIG_HEAD`), needed
    /// for the `reset --hard` inverse. `post_merge_sha` is HEAD after.
    Merge {
        source: String,
        pre_merge_sha: String,
        post_merge_sha: String,
    },
    /// Stash push. `stash_sha` is the new top-of-stash commit so undo
    /// can pop the same stash even if the user pushed others on top
    /// before undoing. `include_untracked` / `include_ignored` record the
    /// original flags so the redo re-stashes with the same scope. Both
    /// default (untracked on, ignored off) for logs written before the
    /// flags were recorded.
    StashPush {
        stash_sha: String,
        #[serde(default = "default_include_untracked")]
        include_untracked: bool,
        #[serde(default)]
        include_ignored: bool,
    },
    /// Stash pop. `stash_sha` is the popped stash commit so undo can
    /// re-stash to the same state.
    StashPop { stash_sha: String },
}

impl OpKind {
    /// Human-readable label for toolbar tooltips ("Undo commit", "Undo
    /// merge of feat-x", …). Sub-PR 2 uses this to populate the Undo
    /// button's `title` attribute via `get_undo_redo_state`.
    pub fn human_label(&self) -> String {
        let short = |sha: &str| sha.chars().take(7).collect::<String>();
        match self {
            OpKind::Commit { .. } => "commit".into(),
            OpKind::Amend { .. } => "amend".into(),
            OpKind::CheckoutBranch { to, .. } => format!("checkout to {to}"),
            OpKind::CheckoutCommit { to_sha, .. } => format!("checkout to {}", short(to_sha)),
            OpKind::Reset { to_sha, mode, .. } => {
                format!("{} reset to {}", reset_mode_str(*mode), short(to_sha))
            }
            OpKind::CherryPick { applied_sha, .. } => {
                format!("cherry-pick of {}", short(applied_sha))
            }
            OpKind::Revert { reverted_sha, .. } => format!("revert of {}", short(reverted_sha)),
            OpKind::Merge { source, .. } => format!("merge of {source}"),
            OpKind::StashPush { .. } => "stash push".into(),
            OpKind::StashPop { .. } => "stash pop".into(),
        }
    }

    /// Canonical reflog tag — written as the reflog message of the
    /// underlying ref update. Format: `yryvu:op=<kind>|<key>=<value>|...`
    /// kept simple enough that an external grep can find yryvu-tagged
    /// entries in `.git/logs/HEAD`.
    pub fn reflog_tag(&self) -> String {
        match self {
            OpKind::Commit { sha, parent_sha } => format!(
                "{}commit|sha={}|parent={}",
                REFLOG_TAG_PREFIX,
                sha,
                parent_sha.as_deref().unwrap_or("none"),
            ),
            OpKind::Amend { old_sha, new_sha } => {
                format!("{}amend|old={}|new={}", REFLOG_TAG_PREFIX, old_sha, new_sha,)
            }
            OpKind::CheckoutBranch { from, to } => {
                format!(
                    "{}checkout-branch|from={}|to={}",
                    REFLOG_TAG_PREFIX, from, to
                )
            }
            OpKind::CheckoutCommit { from, to_sha } => format!(
                "{}checkout-commit|from={}|to={}",
                REFLOG_TAG_PREFIX, from, to_sha,
            ),
            OpKind::Reset {
                mode,
                from_sha,
                to_sha,
            } => format!(
                "{}reset|mode={}|from={}|to={}",
                REFLOG_TAG_PREFIX,
                reset_mode_str(*mode),
                from_sha,
                to_sha,
            ),
            OpKind::CherryPick {
                applied_sha,
                new_sha,
            } => format!(
                "{}cherry-pick|applied={}|new={}",
                REFLOG_TAG_PREFIX, applied_sha, new_sha,
            ),
            OpKind::Revert {
                reverted_sha,
                new_sha,
            } => format!(
                "{}revert|reverted={}|new={}",
                REFLOG_TAG_PREFIX, reverted_sha, new_sha,
            ),
            OpKind::Merge {
                source,
                pre_merge_sha,
                post_merge_sha,
            } => format!(
                "{}merge|source={}|pre={}|post={}",
                REFLOG_TAG_PREFIX, source, pre_merge_sha, post_merge_sha,
            ),
            OpKind::StashPush { stash_sha, .. } => {
                format!("{}stash-push|sha={}", REFLOG_TAG_PREFIX, stash_sha)
            }
            OpKind::StashPop { stash_sha } => {
                format!("{}stash-pop|sha={}", REFLOG_TAG_PREFIX, stash_sha)
            }
        }
    }
}

fn reset_mode_str(mode: ResetMode) -> &'static str {
    match mode {
        ResetMode::Soft => "soft",
        ResetMode::Mixed => "mixed",
        ResetMode::Hard => "hard",
    }
}

/// One entry in the undo log. `timestamp` is unix seconds (matches the
/// reflog's own `committer time` resolution; sub-second granularity adds
/// no value here).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Op {
    pub kind: OpKind,
    pub timestamp: u64,
}

/// Full sidecar structure. `cursor` is the index of the most-recently
/// applied op — typically `ops.len() - 1` after appending. Sub-PR 2's
/// undo decrements it; redo re-increments. Stored explicitly (rather
/// than derived) so a redo cursor surviving across app restarts lines
/// up with where the user left off.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct UndoLog {
    pub ops: Vec<Op>,
    pub cursor: Option<usize>,
}
