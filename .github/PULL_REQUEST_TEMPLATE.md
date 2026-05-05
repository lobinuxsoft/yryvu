## Description

<!-- Brief description of the changes -->

## Related Issue

Closes #<!-- issue number -->

<!--
IMPORTANT REMINDERS:
- All PRs must target `development` branch (NOT `main` — `main` is auto-managed by release-please)
- Use `gh issue develop <NUM> --base development --checkout` to create the branch
- Every PR must be linked to an issue (Issue-First Development)
- Use `--merge` (NEVER `--squash`) to preserve graph history
-->

## Type of Change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to change)
- [ ] Documentation update
- [ ] Refactoring (no functional changes)

## Area

<!-- Check the areas affected by this PR -->
- [ ] `ui` — frontend (SolidJS, Tauri shell, CSS)
- [ ] `git-core` — Rust git backend (gix / git2 ops, repo modules)
- [ ] `integrations` — GitHub / GitLab / Bitbucket / Azure / Jira (OAuth, APIs, preflight)
- [ ] `infra` — CI workflows, release-please, build scripts, Cargo workspace
- [ ] `documentation` — README, research docs, code comments

## Checklist

- [ ] This PR targets `development` branch
- [ ] This PR is linked to an existing issue (`Closes #N` or `Refs #N`)
- [ ] My commits follow Conventional Commits format **in English** (`feat:`, `fix:`, `refactor:`, `docs:`, etc.) without AI signatures
- [ ] My code follows the project's code standards (rustfmt, clippy with `-D warnings`)
- [ ] I have run `cargo test --workspace` and it passes
- [ ] I have tested the change in `bun tauri dev` (UI changes only)
- [ ] No file in this PR exceeds 400 LOC (or the new file is justified — e.g. catalogue / single-impl-block)
- [ ] No secrets, credentials, or `.env*` files committed

## Screenshots / Demo

<!-- If applicable, add screenshots or GIFs demonstrating the change -->

## Additional Notes

<!-- Any other context or information reviewers should know -->
