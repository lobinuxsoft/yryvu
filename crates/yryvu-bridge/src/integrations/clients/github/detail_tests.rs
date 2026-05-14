// SPDX-License-Identifier: AGPL-3.0-or-later

//! Inline tests for [`super`] — split via `#[path]` to keep the
//! production module under the 400 LOC cap.

use super::*;

#[test]
fn project_detail_open_pr_basic() {
    let raw: GhPullDetail = serde_json::from_value(serde_json::json!({
        "number": 91,
        "title": "Add detail view",
        "state": "open",
        "draft": false,
        "user": { "login": "lobinuxsoft", "avatar_url": "https://a/m" },
        "created_at": "2026-05-14T10:00:00Z",
        "updated_at": "2026-05-14T11:00:00Z",
        "html_url": "https://github.com/o/r/pull/91",
        "body": "Detail body here.",
        "base": { "ref": "development", "sha": "basesha" },
        "head": { "ref": "91-feat-detail", "sha": "headsha" },
        "additions": 1500,
        "deletions": 80,
        "changed_files": 42,
        "comments": 7,
        "mergeable": true,
        "mergeable_state": "clean",
    }))
    .unwrap();
    let d = project_detail(raw);
    assert_eq!(d.number, 91);
    assert_eq!(d.state, PullRequestState::Open);
    assert_eq!(d.body, "Detail body here.");
    assert_eq!(d.additions, 1500);
    assert_eq!(d.changed_files, 42);
    assert_eq!(d.mergeable, Some(true));
    assert_eq!(d.mergeable_state.as_deref(), Some("clean"));
}

#[test]
fn project_detail_merged_state() {
    let raw: GhPullDetail = serde_json::from_value(serde_json::json!({
        "number": 1,
        "state": "closed",
        "merged_at": "2026-05-10T12:00:00Z",
        "user": { "login": "x", "avatar_url": "x" },
        "base": { "ref": "main", "sha": "x" },
        "head": { "ref": "f", "sha": "x" }
    }))
    .unwrap();
    let d = project_detail(raw);
    assert_eq!(d.state, PullRequestState::Merged);
    assert!(d.merged_at.is_some());
}

#[test]
fn project_commit_short_sha_takes_first_7() {
    let raw: GhPrCommit = serde_json::from_value(serde_json::json!({
        "sha": "abcdef1234567890",
        "commit": {
            "message": "fix: thing",
            "author": { "name": "Alice", "date": "2026-05-14T10:00:00Z" }
        },
        "author": { "login": "alice", "avatar_url": "https://a/a" }
    }))
    .unwrap();
    let c = project_commit(raw);
    assert_eq!(c.short_sha, "abcdef1");
    assert_eq!(c.author.login, "alice");
    assert_eq!(c.message, "fix: thing");
}

#[test]
fn project_commit_falls_back_to_commit_author_when_no_github_user() {
    // Commits authored by an email that doesn't map to a GitHub
    // user (synced via SSH push without GitHub identity) come
    // back with `author: null` — we surface the commit-time name.
    let raw: GhPrCommit = serde_json::from_value(serde_json::json!({
        "sha": "abc",
        "commit": {
            "message": "x",
            "author": { "name": "Anon", "date": "2026-05-14T10:00:00Z" }
        },
        "author": null
    }))
    .unwrap();
    let c = project_commit(raw);
    assert_eq!(c.author.login, "Anon");
    assert!(c.author.avatar_url.is_empty());
}

#[test]
fn project_file_renamed_keeps_previous() {
    let raw: GhPrFile = serde_json::from_value(serde_json::json!({
        "filename": "new.rs",
        "previous_filename": "old.rs",
        "status": "renamed",
        "additions": 0,
        "deletions": 0,
        "patch": null
    }))
    .unwrap();
    let f = project_file(raw);
    assert_eq!(f.filename, "new.rs");
    assert_eq!(f.previous_filename.as_deref(), Some("old.rs"));
    assert_eq!(f.status, "renamed");
}

#[test]
fn project_check_partial_completion() {
    let raw: GhCheckRun = serde_json::from_value(serde_json::json!({
        "name": "build",
        "status": "in_progress",
        "conclusion": null,
        "details_url": "https://gh/run/123",
        "started_at": "2026-05-14T10:00:00Z"
    }))
    .unwrap();
    let c = project_check(raw);
    assert_eq!(c.status, "in_progress");
    assert_eq!(c.conclusion, None);
    assert_eq!(c.details_url.as_deref(), Some("https://gh/run/123"));
}
