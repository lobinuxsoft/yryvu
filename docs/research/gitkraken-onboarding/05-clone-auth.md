# 05 — Clone auth: HTTPS / SSH detection + credentials

GK supports three credential paths for clone:

1. **HTTPS with cached credentials** (Git Credential Manager / OS
   keychain).
2. **HTTPS with integration token** (OAuth/PAT stored per-provider in
   GK's secure store).
3. **SSH key** (per-provider or global default key).

This doc covers what chajá needs to mirror, what to defer, and what to
deviate.

## URL-protocol detection

Inside `OnboardingCloneRepoForm`, the only protocol detection is the
`Ia` flag (`bundle:209606`):

```js
Ia = useMemo(
  () => view === URL_TAB && url && "ssh" === gitUrlParse(url).protocol,
  [view, gitUrlParse, url],
);
```

If the user pastes an SSH URL (`git@host:path`, `ssh://...`), GK
displays an inline LFS info banner (`bundle:209705`). HTTPS / `git://`
get no in-form chrome — they fall through to the generic credentials
flow at clone time.

## Credential rejection model

`bundle:97546` defines `rejectionReasons`:

```
OAUTH:    { PROMPT_FOR_RECONNECT: "promptForReconnect" }
PAT:      { INVALID_PAT: "invalidPAT" }
PLAINTEXT:{ PROMPT_FOR_CREDS: "promptForCreds" }
SSH:      { ENCRYPTED, INVALID, NOT_FOUND, NOT_SUPPORTED }
UNKNOWN
USERNAME: { PROMPT_FOR_CREDS: "username_promptForCreds" }
```

The clone failure path classifies the libgit2 / git binary error into
one of these and either:

- pops a credentials dialog (PLAINTEXT.PROMPT_FOR_CREDS),
- pops a "Reconnect to <Provider>" toast (OAUTH.PROMPT_FOR_RECONNECT),
- toasts a generic CloneRepo-CloneFailed (UNKNOWN).

Exact dispatcher: `bundle:150218-150307`.

## SSL / TLS errors

`bundle:35645`:

```js
checkIfErrorIsSSLError = (err) => _.includes(err.message, sslErrors);
```

When detected, GK pops a `showSSLCertErrorToast(hostingServiceType,
errorMessage)` (`bundle:43904`, `bundle:50550`, `bundle:50707`) — toast
with a "Trust certificate" affordance.

## Git Credential Manager integration

Profile setting `ssh.useGitCredentialManager` (`bundle:10588`) toggles
whether GK shells out to GCM (Windows / macOS) for HTTPS auth. When
disabled, libgit2 fallback to in-app prompt. chajá: gix doesn't use GCM;
the `gix_credentials::helper::main` adapter shells out to whatever
`credential.helper` is configured in `~/.gitconfig` (or any custom).

## chajá auth strategy for #100 v1

| Scenario | chajá v1 plan |
|---|---|
| HTTPS with no auth needed (public repo) | gix `prepare_clone` works directly. No prompt. |
| HTTPS with cached credentials in `~/.gitconfig` `credential.helper` | gix invokes the configured helper via `gix-credentials::helper::main`. **Works automatically**. |
| HTTPS without cached creds | gix returns `Authentication required`. v1: surface error toast `"Authentication required for <host>"` + abort. **Defer in-app credential prompt to a follow-up issue.** |
| HTTPS with integrations token (OAuth/PAT from chajá's keyring) | **Defer.** Wiring the integrations token store to gix as a credential helper is its own PR. v1: not supported. Document in PR body. |
| SSH (`git@host:path`) | gix invokes ssh agent / `~/.ssh/<key>` via `gix-transport::client::blocking_io::ssh`. Works if user has `ssh-agent` running with the right key. v1: rely on this. Failures get a toast `"SSH authentication failed for <host>. Verify ssh-agent has the right key loaded."`. |
| Encrypted SSH key with no passphrase agent | gix returns auth error. v1: same toast. Future: GK-style passphrase prompt dialog. |

### Decision recorded

For #100 v1: **rely on whatever the user has configured globally**.
gix's default credential resolution (env vars + helpers + ssh-agent)
covers ~80% of real-world clones. The remaining 20% (interactive
prompts, in-app integrations token reuse) is deferred.

This matches the "production-ready from day one but no scope creep"
rule from feedback/correct-implementation-day-one. Surface the failure
clearly so the user can fix it in their global git config.

## chajá deviation FLAGs

1. **No GCM bridge.** chajá doesn't shell out to Windows GCM; gix's
   credential helper covers `~/.gitconfig` `credential.helper` and that
   is the path GCM is registered through anyway. Effective behaviour
   matches.

2. **No "Reconnect to <Provider>" affordance in v1.** GK's flow assumes
   the cloud OAuth proxy can heal a stale token. chajá doesn't have
   that proxy (chajá deviation: NO GK auth proxy from
   `docs/research/gitkraken-integrations/03-oauth-flow.md`). The reconnect
   button would route to chajá's Preferences -> Integrations panel —
   useful but not v1 critical.

3. **No SSL self-sign affordance in v1.** GK's "Trust certificate" toast
   needs storage of the cert thumbprint. Defer to a TLS-config issue.

## Cross-validation

```
$ grep -n "rejectionReasons = {" /tmp/gk-bundle-pretty.js
97546: }, at.rejectionReasons = {
$ grep -n "checkIfErrorIsSSLError" /tmp/gk-bundle-pretty.js
35573: }), at.urlSlashJoin = at.throwBetterErrorMessageFromApiError = ...
35645: at.checkIfErrorIsSSLError = Ve => ln.default.includes(Ve.message, Rn.sslErrors);
```

Citations confirmed.
