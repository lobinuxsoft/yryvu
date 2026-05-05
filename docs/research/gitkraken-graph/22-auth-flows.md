# Authentication flows

GitKraken authenticates against three worlds at once: HTTPS Git remotes
(PATs or OAuth tokens), SSH Git remotes (keys + passphrase), and
hosting-service APIs (OAuth for PR listing, issue creation, etc.). The
bundle shows a deliberate separation between two axes — **transport
credentials** (Git push/pull) vs **integration credentials** (GitHub /
GitLab / Bitbucket / Azure REST APIs) — even when they point at the
same provider. Credentials are scoped per profile
(`credentialsByProfileGuid`) so a user running multiple workspaces does
not leak tokens across them.

## OAuth provider flow

Primary login path: `loginWithOAuthSaga`, kicked off by
`onLoginWithOAuthProvider`.
`getGitKrakenOAuthUrlByHostingServiceType` builds the provider-specific
authorisation URL (GitHub / GitLab / Bitbucket / Azure DevOps), a
browser window opens, and `rationDataAfterSuccessfulOAuthSaga` handles
the callback. `cancelLoginWithOAuthSaga` covers "user closed the
browser"; `lectedLoginTypePerformingOAuth` is the state flag the UI
watches to show a spinner. Failure lands in `handleOAuthFailure` with
a retry path (`RetryWithoutOAuthLabel`) that falls back to PAT entry.

`hasUserInRemoteUrlUsingOauthIntegration` is how GitKraken decides
whether a `https://user@host/...` URL should surface the OAuth token
of that integration instead of asking for credentials.

**Device-code sub-flow is not present** as a dedicated symbol set;
GitKraken prefers the browser-redirect OAuth flow even in the desktop
app. What is present is a **manual token** escape hatch:
`PromptForOAuthToken` + `handleManualIntegrationTokenInputSaga` +
`trySaveOAuthToken` let a user paste a token directly. The trio
`ManualIntegrationCredentialsSaveStarted` / `...Succeeded` /
`...Finished` instruments it.

## PAT storage

Personal Access Tokens share a single vault with OAuth tokens:
`makeOAuthCredsObjectSaga` wraps them both in the same shape. The
access-token blob is keyed by `accessTokenKey` with an
`accessTokenMetadata` side-table holding expiry, scopes, and provider.
`getIntegrationAccessTokenMetadataForCurrentProfile` is the lookup.
Retrieval for use in a Git operation goes through
`getHttpCredentialsForUrlSaga`, which resolves a URL to the right
PAT/OAuth blob by hostname matching.

## SSH keys

Distinct branch. `addSSHKey`, `addSSHKeyToServiceSaga`,
`addExternalSSHKeyToServiceSaga` cover both GitKraken-generated and
user-imported keys.
`generateSshKeyAndAddToServiceSaga` + `GenerateAndCopySSHKey` produce a
new key pair and can copy the public part straight to GitHub / GitLab
via REST (`createPublicSshKeyForAuthenticatedUser`). Discovery uses
`BrowseForPrivateSSHKey` / `BrowseForPublicSSHKey`. Passphrase
handling: `EnterSSHPassphrase` / `EnterServiceSSHPassphrase` with
`IncorrectSSHPassphrase` for wrong entries and
`retrievePassphraseForKeySaga` for the cached variant
(`passphrasesByKey` / `passphraseToKey`).

## Credential helper integration

`getIsGitCredentialManagerEnabled` +
`getIsGitCredentialManagerEnabledSetting` + `useGitCredentialManager`
+ `useGitCredentialManagerHelp` prove GitKraken can defer to
`git-credential-manager` when the user opts in (setting in profile
prefs). When enabled, `getHttpCredentialsForUrlSaga` delegates to GCM
instead of GitKraken's own vault. `getCredentialsFromSecStorePassphrase`
+ `getSecStorePassphraseForCredentials` show the internal vault itself
is an encrypted "secure store" protected by a passphrase — effectively
GitKraken's own keychain layer on top of the OS.

## On-demand trigger

Auth is **lazy**: credentials are only fetched when libgit2 fires the
`credentialCb` callback during push / pull / fetch. State flags
`credentialLock` and `credentialsByParentProcessId` serialise
concurrent credential requests (two simultaneous pushes must not both
prompt). `credentialRejection` is the signal that the credential
callback returned "user cancelled".

## Token refresh

`clientRefreshToken`, `clearAccessToken`, `clearAccessTokenSaga`,
`viderTokenAfterSuccessfulOAuthIfNeededSaga` — the latter is the
refresh hook that fires after a successful OAuth round-trip to
re-persist the new access token. `OAuthInvalid` is the error case.

## Error UX mid-operation

When libgit2 rejects the credential callback,
`InvalidCredentialsForUrl` / `EnterCredentialsForUrl` /
`CredentialsError` are raised. The UI shows a modal pinned to the
in-flight operation rather than a toast — the op is paused waiting
for retry. `badCredentialMessageByIntegration` gives a per-provider
error string. `handleVerifyIntegrationCredentialsFailedSaga` handles
integration-API failures separately — those are non-blocking, they
just disable PR panels until re-auth.

## Per-remote scoping

`clearCredentialsForUrl` / `deleteUrlCredentials` /
`ForgetAllCredentials` confirm the unit of credential scoping is the
**URL**, not the remote name. Two remotes pointing at `github.com/a`
and `github.com/b` share the same PAT if that PAT's scopes cover both.

## Algorithm (pseudocode)

```
callback credentialCb(url, usernameHint, allowedTypes):
    acquire credentialLock(url)
    if gitCredentialManagerEnabled:
        return gcm.get(url) or null
    creds = vault.lookupByUrl(url, currentProfile)
    if creds == null:
        ask user: [OAuth] | [Paste PAT] | [SSH key] | [Cancel]
        if OAuth:
            loginWithOAuthSaga(provider)
            creds = awaitCallback()
        elif PAT:
            creds = promptForToken()
            trySaveOAuthToken(creds)
        elif SSH:
            creds = selectOrGenerateKey()
            askPassphrase()
    if creds.expired:
        viderTokenAfterSuccessfulOAuthIfNeeded()
    return creds
```

## Chajá implications

- **Split credential storage into transport vs integration buckets**
  from the start — mixing them makes PAT invalidation a nightmare.
- **Use the OS keychain** (libsecret on Fedora, Keychain on macOS,
  Credential Manager on Windows) through a Tauri plugin; do not roll
  an encrypted file vault unless you want to support
  `git-credential-manager` interop properly.
- **Lazy callback model from libgit2 is the right default**: never
  prompt for credentials at repo-open, only at push / fetch time.
- **Borrow `hasUserInRemoteUrlUsingOauthIntegration`'s logic** to
  auto-match a stored integration token to a matching HTTPS remote
  URL — it removes a huge class of "why isn't it using my token"
  tickets.
- **Concurrent credential lock** is critical for usability under
  parallel push / fetch.

## Source locations

- `/tmp/gk-asar/src/render/static/entryPoints/main/render.bundle.js`
- Symbols: `loginWithOAuthSaga`, `cancelLoginWithOAuthSaga`,
  `onLoginWithOAuthProvider`, `getGitKrakenOAuthUrlByHostingServiceType`,
  `rationDataAfterSuccessfulOAuthSaga`, `handleOAuthFailure`,
  `RetryWithoutOAuthLabel`, `hasUserInRemoteUrlUsingOauthIntegration`,
  `PromptForOAuthToken`, `trySaveOAuthToken`,
  `makeOAuthCredsObjectSaga`, `handleManualIntegrationTokenInputSaga`,
  `ManualIntegrationCredentialsSaveStarted`, `accessTokenKey`,
  `accessTokenMetadata`,
  `getIntegrationAccessTokenMetadataForCurrentProfile`,
  `getHttpCredentialsForUrlSaga`, `credentialLock`,
  `credentialsByProfileGuid`, `credentialRejection`,
  `addSSHKeyToServiceSaga`, `addExternalSSHKeyToServiceSaga`,
  `generateSshKeyAndAddToServiceSaga`,
  `createPublicSshKeyForAuthenticatedUser`, `BrowseForPrivateSSHKey`,
  `EnterSSHPassphrase`, `IncorrectSSHPassphrase`,
  `retrievePassphraseForKeySaga`, `passphrasesByKey`,
  `getIsGitCredentialManagerEnabled`, `useGitCredentialManager`,
  `getCredentialsFromSecStorePassphrase`,
  `getSecStorePassphraseForCredentials`, `clientRefreshToken`,
  `clearAccessTokenSaga`, `viderTokenAfterSuccessfulOAuthIfNeededSaga`,
  `OAuthInvalid`, `InvalidCredentialsForUrl`,
  `EnterCredentialsForUrl`, `badCredentialMessageByIntegration`,
  `handleVerifyIntegrationCredentialsFailedSaga`,
  `clearCredentialsForUrl`, `ForgetAllCredentials`.
