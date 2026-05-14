// SPDX-License-Identifier: AGPL-3.0-or-later

//! Inline tests for [`super`] — split via `#[path]` to keep the
//! production module under the 400 LOC cap.

use super::*;

fn parse(json: &str) -> GhPull {
    serde_json::from_str(json).expect("valid GhPull JSON")
}

fn summary(json: &str) -> PullRequestSummary {
    PullRequestSummary::from(parse(json))
}

#[test]
fn project_open_pr() {
    let s = summary(
        r#"{
        "number": 42,
        "title": "Add walking skeleton",
        "state": "open",
        "draft": false,
        "merged_at": null,
        "user": { "login": "lobinuxsoft", "avatar_url": "https://avatars.example/42" },
        "created_at": "2026-05-14T10:00:00Z",
        "updated_at": "2026-05-14T11:00:00Z",
        "html_url": "https://github.com/lobinuxsoft/yryvu/pull/42",
        "base": { "ref": "development" },
        "head": { "ref": "15-feat-pr-list" }
    }"#,
    );
    assert_eq!(s.number, 42);
    assert_eq!(s.state, PullRequestState::Open);
    assert!(!s.draft);
    assert_eq!(s.author.login, "lobinuxsoft");
    assert_eq!(s.author.display_name, "lobinuxsoft");
    assert_eq!(s.base_ref, "development");
    assert_eq!(s.head_ref, "15-feat-pr-list");
    assert!(s.labels.is_empty());
    assert!(s.assignees.is_empty());
    assert!(s.requested_reviewers.is_empty());
    assert!(s.review_decision.is_none());
    assert!(s.ci_status.is_none());
}

#[test]
fn project_with_labels_and_chips() {
    let s = summary(
        r#"{
        "number": 360,
        "title": "wave-2",
        "state": "open",
        "draft": false,
        "merged_at": null,
        "user": { "login": "x", "avatar_url": "x" },
        "created_at": "x",
        "updated_at": "x",
        "html_url": "x",
        "base": { "ref": "main" },
        "head": { "ref": "wave-2" },
        "labels": [
            { "name": "bug", "color": "d93f0b" },
            { "name": "wave-2", "color": "0e8a16" }
        ],
        "assignees": [
            { "login": "alice", "avatar_url": "https://avatars.example/alice" }
        ],
        "requested_reviewers": [
            { "login": "bob", "avatar_url": "https://avatars.example/bob" },
            { "login": "carol", "avatar_url": "https://avatars.example/carol" }
        ]
    }"#,
    );
    assert_eq!(s.labels.len(), 2);
    assert_eq!(s.labels[0].name, "bug");
    assert_eq!(s.labels[0].color, "d93f0b");
    assert_eq!(s.assignees.len(), 1);
    assert_eq!(s.assignees[0].login, "alice");
    assert_eq!(s.requested_reviewers.len(), 2);
    assert_eq!(s.requested_reviewers[1].login, "carol");
}

#[test]
fn project_with_extra_label_fields_ignored() {
    let s = summary(
        r#"{
        "number": 1,
        "title": "x",
        "state": "open",
        "draft": false,
        "merged_at": null,
        "user": { "login": "x", "avatar_url": "x" },
        "created_at": "x",
        "updated_at": "x",
        "html_url": "x",
        "base": { "ref": "main" },
        "head": { "ref": "x" },
        "labels": [
            { "id": 123, "name": "good first issue", "color": "7057ff", "description": "Beginner-friendly", "default": true, "url": "https://api.github.com/..." }
        ]
    }"#,
    );
    assert_eq!(s.labels.len(), 1);
    assert_eq!(s.labels[0].name, "good first issue");
    assert_eq!(s.labels[0].color, "7057ff");
}

#[test]
fn project_merged_pr_collapses_state() {
    let s = summary(
        r#"{
        "number": 100,
        "title": "Old feature",
        "state": "closed",
        "draft": false,
        "merged_at": "2026-05-10T12:00:00Z",
        "user": { "login": "octocat", "avatar_url": "https://avatars.example/octocat" },
        "created_at": "2026-05-01T10:00:00Z",
        "updated_at": "2026-05-10T12:00:00Z",
        "html_url": "https://github.com/owner/repo/pull/100",
        "base": { "ref": "main" },
        "head": { "ref": "f" }
    }"#,
    );
    assert_eq!(s.state, PullRequestState::Merged);
}

#[test]
fn project_closed_without_merge() {
    let s = summary(
        r#"{
        "number": 7,
        "title": "Abandoned",
        "state": "closed",
        "draft": false,
        "merged_at": null,
        "user": { "login": "octocat", "avatar_url": "x" },
        "created_at": "2026-05-01T10:00:00Z",
        "updated_at": "2026-05-02T10:00:00Z",
        "html_url": "x",
        "base": { "ref": "main" },
        "head": { "ref": "x" }
    }"#,
    );
    assert_eq!(s.state, PullRequestState::Closed);
}

#[test]
fn project_draft_pr() {
    let s = summary(
        r#"{
        "number": 5,
        "title": "WIP",
        "state": "open",
        "draft": true,
        "merged_at": null,
        "user": { "login": "x", "avatar_url": "x" },
        "created_at": "x",
        "updated_at": "x",
        "html_url": "x",
        "base": { "ref": "main" },
        "head": { "ref": "wip" }
    }"#,
    );
    assert_eq!(s.state, PullRequestState::Open);
    assert!(s.draft);
}

#[test]
fn project_missing_draft_defaults_false() {
    let s = summary(
        r#"{
        "number": 1,
        "title": "x",
        "state": "open",
        "merged_at": null,
        "user": { "login": "x", "avatar_url": "x" },
        "created_at": "x",
        "updated_at": "x",
        "html_url": "x",
        "base": { "ref": "main" },
        "head": { "ref": "x" }
    }"#,
    );
    assert!(!s.draft);
}

#[test]
fn state_serializes_lowercase() {
    assert_eq!(
        serde_json::to_string(&PullRequestState::Open).unwrap(),
        "\"open\""
    );
    assert_eq!(
        serde_json::to_string(&PullRequestState::Merged).unwrap(),
        "\"merged\""
    );
    assert_eq!(
        serde_json::to_string(&PullRequestState::Closed).unwrap(),
        "\"closed\""
    );
}

#[test]
fn review_decision_serializes_snake_case() {
    assert_eq!(
        serde_json::to_string(&ReviewDecision::Approved).unwrap(),
        "\"approved\""
    );
    assert_eq!(
        serde_json::to_string(&ReviewDecision::ChangesRequested).unwrap(),
        "\"changes_requested\""
    );
    assert_eq!(
        serde_json::to_string(&ReviewDecision::ReviewRequired).unwrap(),
        "\"review_required\""
    );
}

#[test]
fn ci_status_serializes_snake_case() {
    for (variant, expected) in [
        (CiStatus::Success, "\"success\""),
        (CiStatus::Failure, "\"failure\""),
        (CiStatus::Pending, "\"pending\""),
        (CiStatus::Error, "\"error\""),
        (CiStatus::Expected, "\"expected\""),
    ] {
        assert_eq!(serde_json::to_string(&variant).unwrap(), expected);
    }
}
