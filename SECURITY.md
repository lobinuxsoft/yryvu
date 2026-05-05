# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest release on `main` | Yes |
| `development` branch | Best-effort |
| Older releases | No |

As an early-stage project, only the latest release receives security updates.

## Reporting a Vulnerability

**Please do NOT open a public issue.** Instead:

1. **Preferred**: Open a [private security advisory](https://github.com/lobinuxsoft/chaja/security/advisories/new) on GitHub. The maintainer is notified privately and a CVE can be coordinated if needed.
2. **Alternative**: Contact the maintainer directly through a private GitHub Discussion message.
3. Include as much detail as possible: affected version, reproduction steps, expected vs. actual behaviour, and the impact you believe the issue has.

## Response Timeline

- **Acknowledgment**: within 72 hours
- **Initial assessment**: within 1 week
- **Coordinated disclosure timeline**: agreed with reporter after assessment

## Scope

This policy applies to:

- The Chajá application source code (Rust backend, Tauri shell, SolidJS frontend)
- The git-backend implementation (`gix` + `git2` hybrid in `crates/chaja-bridge/src/repo/`)
- The integrations layer (OAuth flow, PAT entry, keyring storage, sidecar config — `crates/chaja-bridge/src/integrations/`)
- The undo log sidecar (`.git/chaja-undo.json`)
- Any pre-built release binaries published from this repository

**Out of scope**:

- Third-party crates (`gix`, `git2`, `oauth2`, `keyring`, `tauri`, etc.) — report to their respective projects.
- User-supplied repository contents — Chajá reads what `git` reads; if `git` parses it safely, Chajá does too.
- The user's OS-level keyring backend (libsecret, macOS Keychain, Windows Credential Vault).

## Security Considerations

Chajá handles several classes of sensitive data:

- **OAuth access tokens** (GitHub, GitLab, Bitbucket, Azure DevOps, Jira) — stored in the OS keyring under service `io.chaja.integrations`. Never logged, never written to disk in plaintext.
- **Personal Access Tokens (PATs)** — same storage path as OAuth tokens.
- **OAuth client secrets** — baked into release binaries via build-time env vars (`CHAJA_*_OAUTH_CLIENT_SECRET`). Considered "extractable from the binary" by design (consistent with all desktop OAuth clients); never present in source code.
- **Local repository contents** — read with the same access the OS gives to the user.
- **Sidecar files** in `.git/` (e.g. `chaja-undo.json`) and the app config dir (`integrations.json`) — written with `0600` permissions, atomic-write to prevent partial-write corruption.

### Best Practices for Users

1. Only authorize Chajá to access repositories / orgs you trust.
2. Use OAuth (preferred) over PATs when possible — narrower scopes + revocable per-app.
3. Revoke OAuth grants you no longer use from your provider's settings page.
4. Keep the application updated (release notes call out security fixes explicitly).

## Recognition

Contributors who responsibly report valid issues will be credited in release notes (unless they prefer anonymity).
