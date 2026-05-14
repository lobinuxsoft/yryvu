# Contributing to Yryvu

Thank you for your interest in contributing! This document outlines the development workflow, code standards, and dev environment setup.

## Quick Reference

| Item | Value |
|------|-------|
| PRs target | `development` branch (NEVER `main` — `main` is auto-managed by release-please) |
| Merge strategy | `--merge` (NEVER `--squash` — squash breaks graph connectivity) |
| Commit language | English |
| Commit format | [Conventional Commits](https://www.conventionalcommits.org/) without AI signatures |
| Code comments | English |
| Monolith threshold | 400 LOC per file |

## Stack

- **Backend (`crates/yryvu-bridge`, `crates/graph-core`)** — Rust 1.85+, gix + git2 hybrid backend, Tauri command surface.
- **Frontend (`apps/yryvu-app`)** — SolidJS + TypeScript + Vite + Tauri v2.
- **Build system** — Cargo workspace + Bun for the frontend.

## Issue-First Development

**Always create an issue before coding.**

```
Create Issue → Create Branch → Develop → PR to development → User merges → Close Issue
```

This ensures work is tracked, discussed, and properly scoped before implementation begins.

## Branch Naming

Create branches from issues using `gh issue develop`:

```bash
gh issue develop <NUM> --base development --checkout
```

This generates a branch name like `<NUM>-<title-slug>` automatically.

## Commit Messages

Write commits in **English** using Conventional Commits format. **NO AI signatures** (no "Co-Authored-By: Claude", "Generated with...", etc.):

```
feat: add OAuth flow scaffold
fix(integrations): use Vec::contains over manual iter().any()
refactor(styles): split commit-graph.css into focused submodules
docs(research): GitKraken integrations audit (11 docs)
```

### Types that release-please picks up

| Type | Bumps |
|------|-------|
| `feat` | MINOR |
| `fix` | PATCH |
| `BREAKING CHANGE:` footer or `feat!:` / `fix!:` | MAJOR |

Other prefixes (`docs:`, `chore:`, `refactor:`, `test:`, `ci:`, `style:`, `perf:`, `build:`) do NOT trigger releases.

## Pull Requests

1. **Target branch**: `development`
2. **Title**: under 70 characters; details go in the body
3. **Body**: Reference the issue with `Closes #XX` or `Refs #XX`
4. **Merge**: ALWAYS `--merge`, NEVER `--squash`
5. **Issue close**: PRs to `development` do NOT auto-close issues — close manually with `gh issue close <NUM>` after merge
6. **Size**: Keep PRs focused and reviewable; split large refactors into one-commit-per-file when feasible

```bash
gh pr create --base development --title "feat: add OAuth flow scaffold" --body "Closes #258"
```

## Code Standards

### Rust (backend)

| Item | Convention |
|------|------------|
| Modules | snake_case (`backend_impl`, `commit_panel`) |
| Public API | PascalCase types, snake_case functions |
| Private | `_prefix` only when explicitly needed; otherwise `pub(crate)`/`pub(super)` |
| Comments | English; explain WHY, not WHAT |
| Errors | typed `BackendError` variants — no string-only errors at boundaries |
| Style | `cargo fmt --all` clean, `cargo clippy --workspace --all-targets -- -D warnings` clean |

### TypeScript / SolidJS (frontend)

| Item | Convention |
|------|------------|
| Components | PascalCase (`CommitGraph.tsx`, `ConnectionForm.tsx`) |
| Hooks | `useXxx.ts` (camelCase) |
| Files (non-components) | snake_case for utilities, camelCase for stores |
| Variables / Functions | camelCase |
| Types / Interfaces | PascalCase |

### General Guidelines

- **Comments**: English; default to writing none — explain *WHY* not *WHAT*.
- **Files over 400 LOC** are flagged as monolithic in PR review. Split into focused submodules.
- **Security**: never log secrets, tokens, or `.env*` content. Never commit credentials.
- **Tests**: integration tests against a real test repo (`yryvu-testbed`). Mocks discouraged for git ops.

## Dev Environment Setup

### Prerequisites

- Rust 1.85+ via `rustup`
- Bun (https://bun.sh)
- System libraries: `webkit2gtk-4.1`, `libgtk-3-dev`, `libsoup-3.0-dev`, `libssl-dev` (Linux)

### First run

```bash
git clone https://github.com/lobinuxsoft/yryvu.git
cd yryvu

# Install frontend deps
cd apps/yryvu-app && bun install && cd ../..

# Build the workspace once to populate the cache
cargo build

# Run dev (frontend hot-reload + Rust rebuild on change)
cd apps/yryvu-app && bun tauri dev
```

### OAuth secrets (for testing the integrations panel)

OAuth client IDs and secrets are NOT committed. Create `.env.local` at the repo root:

```bash
# .env.local — gitignored, do not commit
CHAJA_GITHUB_OAUTH_CLIENT_ID=<your_github_oauth_app_client_id>
CHAJA_GITHUB_OAUTH_CLIENT_SECRET=<your_github_oauth_app_client_secret>
```

The `crates/yryvu-bridge/build.rs` reads `.env.local` at build time and exposes the values to the binary via `option_env!`. Builds without `.env.local` work fine — the OAuth flow short-circuits with `OAuthNotConfigured` and the rest of the app is unaffected.

### Release builds (maintainer only)

Release binaries (`.deb`, `.AppImage`, `.msi`) are built by `.github/workflows/release.yml` triggered automatically by release-please when a new tag is cut. The workflow needs the same OAuth credentials as the dev build, supplied via **GitHub Repo Secrets**:

| Secret name | Where to set |
|---|---|
| `CHAJA_GITHUB_OAUTH_CLIENT_ID` | Settings → Secrets and variables → Actions → New repository secret |
| `CHAJA_GITHUB_OAUTH_CLIENT_SECRET` | same |

When unset (e.g. forks running CI), the build still succeeds — the OAuth flow simply short-circuits at runtime.

### Common dev workflow

```bash
# Type-check + clippy + fmt before committing
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace

# Frontend type-check
cd apps/yryvu-app && bun run typecheck
```

## Labels

When creating issues, use appropriate labels:

| Category | Labels |
|----------|--------|
| Priority | `priority:critical`, `priority:high`, `priority:medium`, `priority:low` |
| Difficulty | `difficulty:easy`, `difficulty:medium`, `difficulty:hard` |
| Area | `area:ui`, `area:git-core`, `area:integrations`, `area:infra` |
| Other | `bug`, `enhancement`, `next-session` |

## Getting Help

- **Questions**: Open a [Discussion](https://github.com/lobinuxsoft/yryvu/discussions)
- **Bugs**: Create an [Issue](https://github.com/lobinuxsoft/yryvu/issues)
- **Security disclosures**: see [SECURITY.md](SECURITY.md)

## License

By contributing, you agree that your contributions will be licensed under the AGPL v3.
