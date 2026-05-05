# Chajá

> A cross-platform Git client in Rust + Tauri 2 + SolidJS. A kraken-slaying experiment.

**Status:** active development. Early-alpha — no public release yet. The `development` branch is where day-to-day work happens; `main` only moves when release-please cuts a tagged release.

The chajá is a sentinel bird from the South American pampas that screams at the first sign of danger. Naming a Git client after it sets the bar for what we want from the tool: it warns *before* you break the repo, not after.

## Why another Git client?

Chajá is a 1:1 visual + interaction port of GitKraken Desktop, with the proprietary cloud bits replaced by direct provider integrations (GitHub / GitLab / Bitbucket / Azure DevOps / Jira) and the missing parts (OAuth, AGPL license) added. The point isn't to clone GK forever — it's to start from a UX that's already proven and iterate from there.

## Stack

- **`crates/chaja-bridge`** — Rust git backend. Hybrid of [`gix`](https://github.com/Byron/gitoxide) (primary) and [`git2-rs`](https://github.com/rust-lang/git2-rs) (fallback for ops not yet upstreamed in `gix`). Tauri command surface lives here.
- **`crates/graph-core`** — pure-Rust commit-graph lane assignment, separated so it can be tested without the Tauri runtime.
- **`apps/chaja-app`** — SolidJS + TypeScript + Vite frontend, Tauri 2 shell.
- **Build** — Cargo workspace (Rust 1.85+) + Bun for the frontend.

## Getting started (development)

Prerequisites: Rust 1.85+ via `rustup`, Bun (https://bun.sh), and the system libs Tauri needs (`webkit2gtk-4.1`, `libgtk-3-dev`, `libsoup-3.0-dev`, `libssl-dev` on Linux).

```bash
git clone https://github.com/lobinuxsoft/chaja.git
cd chaja

# Install frontend deps
cd apps/chaja-app && bun install && cd ../..

# Run dev (frontend hot-reload + Rust rebuild on change)
cd apps/chaja-app && bun tauri dev
```

For the OAuth integrations panel, copy `.env.local.example` to `.env.local` at the repo root and fill in your own provider client IDs/secrets — see [CONTRIBUTING.md](CONTRIBUTING.md#oauth-secrets-for-testing-the-integrations-panel) for details. Builds without `.env.local` work fine; the OAuth flow short-circuits cleanly.

## Documentation

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — workflow, code standards, dev setup
- [`SECURITY.md`](SECURITY.md) — vulnerability disclosure policy
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — Contributor Covenant 3.0
- [`docs/research/`](docs/research/) — durable specs of the GitKraken behaviour we port

## License

AGPL-3.0-or-later. See [`LICENSE`](LICENSE).
