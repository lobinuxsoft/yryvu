// SPDX-License-Identifier: AGPL-3.0-or-later

//! GitLab project-level merge configuration plumbing — translates the
//! GraphQL enum tokens (`MERGE` / `REBASE_MERGE` / `FF` for method,
//! `never` / `always` / `default_off` / `default_on` for squash) into
//! the cross-provider [`ProjectMergeSettings`] shape consumed by the
//! merge form.
//!
//! Lives in its own module so [`super::detail_raw`] can stay under the
//! 400 LOC cap; the parse helpers + the projection are pure functions
//! over the raw struct.

use super::super::types::{ProjectMergeMethod, ProjectMergeSettings, ProjectSquashOption};
use super::detail_raw::GlDetailProject;

/// Build the cross-provider [`ProjectMergeSettings`] from the raw
/// project-level GraphQL fields. Returns `None` when GitLab didn't
/// surface the settings (introspection-disabled instance, or older
/// self-hosted release with a different schema) — the frontend then
/// falls back to unrestricted radios.
pub(super) fn merge_settings(project: &GlDetailProject) -> Option<ProjectMergeSettings> {
    let method = parse_merge_method(project.merge_method.as_deref())?;
    let squash = parse_squash_option(project.squash_option.as_deref())?;
    Some(ProjectMergeSettings {
        merge_method: method,
        squash_option: squash,
        remove_source_branch_after_merge_default: project
            .remove_source_branch_after_merge
            .unwrap_or(false),
        allow_merge_on_skipped_pipeline: project.allow_merge_on_skipped_pipeline.unwrap_or(true),
    })
}

/// GitLab GraphQL emits the merge method as the SCREAMING_SNAKE_CASE
/// enum names (`MERGE`, `REBASE_MERGE`, `FF`). Unknown values fall
/// through to `None` so the frontend gracefully degrades to the
/// unrestricted radio set.
pub(super) fn parse_merge_method(raw: Option<&str>) -> Option<ProjectMergeMethod> {
    match raw? {
        "MERGE" => Some(ProjectMergeMethod::Merge),
        "REBASE_MERGE" => Some(ProjectMergeMethod::RebaseMerge),
        "FF" => Some(ProjectMergeMethod::Ff),
        _ => None,
    }
}

/// Same for the squash option enum — accept the GraphQL flavour
/// (`never` / `always` / `default_off` / `default_on`) plus any
/// camelCase variant a self-hosted release might emit.
pub(super) fn parse_squash_option(raw: Option<&str>) -> Option<ProjectSquashOption> {
    match raw?.to_ascii_lowercase().as_str() {
        "never" => Some(ProjectSquashOption::Never),
        "always" => Some(ProjectSquashOption::Always),
        "default_off" | "defaultoff" => Some(ProjectSquashOption::DefaultOff),
        "default_on" | "defaulton" => Some(ProjectSquashOption::DefaultOn),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_method_known_tokens_map() {
        assert_eq!(
            parse_merge_method(Some("MERGE")),
            Some(ProjectMergeMethod::Merge)
        );
        assert_eq!(
            parse_merge_method(Some("REBASE_MERGE")),
            Some(ProjectMergeMethod::RebaseMerge)
        );
        assert_eq!(parse_merge_method(Some("FF")), Some(ProjectMergeMethod::Ff));
    }

    #[test]
    fn merge_method_unknown_or_missing_returns_none() {
        assert_eq!(parse_merge_method(Some("BOGUS")), None);
        assert_eq!(parse_merge_method(None), None);
    }

    #[test]
    fn squash_option_accepts_snake_and_camel() {
        assert_eq!(
            parse_squash_option(Some("never")),
            Some(ProjectSquashOption::Never)
        );
        assert_eq!(
            parse_squash_option(Some("ALWAYS")),
            Some(ProjectSquashOption::Always)
        );
        assert_eq!(
            parse_squash_option(Some("default_off")),
            Some(ProjectSquashOption::DefaultOff)
        );
        assert_eq!(
            parse_squash_option(Some("defaultOn")),
            Some(ProjectSquashOption::DefaultOn)
        );
    }

    #[test]
    fn squash_option_unknown_returns_none() {
        assert_eq!(parse_squash_option(Some("WHAT")), None);
        assert_eq!(parse_squash_option(None), None);
    }
}
