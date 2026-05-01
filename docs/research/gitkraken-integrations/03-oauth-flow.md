# OAuth flow

GK's OAuth flow is **not** a direct conversation with each provider —
it is mediated by the **GK auth proxy** at the user's
`getApiUrl` endpoint (the GK backend). chajá replaces that mediator
with direct provider OAuth.

## The auth-URL builder (`bundle:52634`)

```js
at.buildAuthUrl = (Ve, at) => {
  if (at === gn.issueTrackerTypes.TRELLO) return `${Ve}/trello-auth/authorize`;
  const ct = gn.integrationInfo[at];
  if (!ct || !ct.authEndpointName) throw new Error(hn.UNEXPECTED_INTEGRATION_TYPE);
  return `${Ve}/oauth/${ct.authEndpointName}/login?action=authorize&in_app=true`
};
```

Two args: `Ve` is the GK API URL base (from `getApiUrl`); `at` is
the integration type. The proxy's path is always
`/oauth/<authEndpointName>/login` with `?action=authorize&in_app=true`.

`authEndpointName` values (from the master table):

| Provider | `authEndpointName` |
|----------|---------------------|
| github | `"github"` |
| gitlab | `"gitlab"` |
| bitbucket | `"bitbucket"` |
| azureDevops | `"azure"` |
| jiraCloud | `"jira"` |

(`githubEnterprise`, `gitlabSelfHosted`, `bitbucketServer`,
`jiraServer` have no `authEndpointName` — they're PAT-only.
`trello` is the special-cased `/trello-auth/authorize`.)

## The dispatch chain

1. UI fires `sendAuthorizationRequest(integrationType)` (action at
   `bundle:146540`).
2. Saga puts `ProtocolIntegrationConnectingUpdated(type, true)` on
   the wire to flip the spinner.
3. Saga IPC-calls `SEND_AUTHORIZATION_REQUEST` to the main process
   (`bundle:166970`).
4. Main process opens the URL via `shell.openExternal` (the system
   default browser — not an in-app `BrowserWindow`).
5. User authorises in their browser; provider redirects to a
   `gitkraken://...` deep-link or an HTTP localhost callback (varies
   per provider's OAuth settings).
6. Main process intercepts callback, posts back to renderer with the
   token via `SET_TOKEN_FROM_SNAKE_CASE_TOKEN` IPC (`bundle:166971`).
7. Renderer dispatches `saveAuthDataForIntegrationType(type, data)`
   (`bundle:146551`) which IPC-calls `SAVE_AUTH_DATA_FOR_INTEGRATION_TYPE`.
8. Main process persists token via secure storage (see
   `06-token-storage.md`), then renderer fires
   `IntegrationCredentialsDeletedForCurrentProfile` / "Save
   Succeeded" actions.

## IPC channels (`bundle:166963`–`166992`)

```js
at.integrationIpcMessageChannels = {
  BLOCKING_REFRESH_NON_EPHEMERAL_ISSUE_TRACKER_DATA_HACK,
  DISCONNECT_INTEGRATION,
  GET_USER,
  REFRESH_INTEGRATION_DATA,
  REFRESH_TOKEN,
  ENSURE_INTEGRATION_DATA_AVAILABLE,
  SEND_AUTHORIZATION_REQUEST,
  SET_TOKEN_FROM_SNAKE_CASE_TOKEN,
  INTEGRATION_API_PREFLIGHT,
  SAVE_AUTH_DATA_FOR_INTEGRATION_TYPE,
  REMOVE_AUTH_TOKEN_FOR_INTEGRATION_TYPE,
  SET_INTEGRATION_REPO_SETUP_RUNNING,
  FETCH_AVATARS_FOR_COMMITS,
  FETCH_GITHUB_COMMENTS_AND_REVIEWS,
  ...
}
```

The OAuth-relevant subset: `SEND_AUTHORIZATION_REQUEST`,
`SET_TOKEN_FROM_SNAKE_CASE_TOKEN`, `REFRESH_TOKEN`,
`SAVE_AUTH_DATA_FOR_INTEGRATION_TYPE`,
`REMOVE_AUTH_TOKEN_FOR_INTEGRATION_TYPE`,
`DISCONNECT_INTEGRATION`. chajá's Tauri `invoke` set should mirror
these names verbatim — they're a clean state machine.

## Browser opening (`bundle:146684`)

Inside `openLinkToGenerateToken`:

```js
yield dt.call(Zr.openExternal, jn);
```

`Zr.openExternal` resolves to the saga that wraps Electron's
`shell.openExternal` — the **system default browser**, not an
in-app webview. Same pattern at `bundle:138712` for SSO login.

> chajá deviation: Tauri 2 equivalent is `tauri-plugin-shell`'s
> `open` API. Same outcome — system browser, not embedded webview.
> Embedded webview for OAuth has a long history of UX disasters
> (password managers don't recognise it, providers refuse the embed
> via `X-Frame-Options`, etc.). Don't.

## OAuth scopes

GK does **not** declare scopes in the bundle — they're declared
server-side by the GK auth proxy on a per-provider basis. The
client only knows the integration type. The user grants scopes on
the provider's consent screen.

> ⚠ unconfirmed — Scopes are in the GK proxy server, not in the
> client bundle. chajá must define its own scope sets per provider
> (when registering its own OAuth apps). Suggested minimum:
>
> | Provider | Scopes |
> |----------|--------|
> | GitHub | `repo`, `read:org`, `read:user`, optionally `workflow` |
> | GitLab | `api`, `read_user`, `read_repository`, `write_repository` |
> | Bitbucket | `repository`, `repository:write`, `pullrequest`, `pullrequest:write`, `account` |
> | Azure DevOps | `vso.code_full`, `vso.work_full`, `vso.profile` |
> | Jira Cloud | `read:jira-work`, `read:jira-user`, `write:jira-work`, `offline_access` |
>
> Validate against each provider's docs at implementation time.

The one PAT-scope hint that's in the bundle is for GitHub
Enterprise (`bundle:166446`):

```js
generateTokenParams: "scopes=repo,admin:org,admin:public_key,workflow&description=GitKraken"
```

This is the querystring deep-linked to GHE's "create PAT" page —
the user lands with the right scopes pre-checked. Mirror this in
chajá's PAT dialog (replace `description=GitKraken` with
`description=chaja`).

## Token refresh (`bundle:146545`)

```js
const refreshTokenForAuth = (Ve, at) => ({
  saga: function* refreshTokenForAuthSaga(ct) {
    yield put(ProtocolIntegrationConnectingUpdated(Ve, true));
    yield call(default, REFRESH_TOKEN, Ve, at);
    yield ct.call(setProtocolIntegrationNotConnecting, Ve);
  }
});
```

`REFRESH_TOKEN` IPC drives main-process refresh logic. Refresh
strategy varies by provider:

- GitHub OAuth: long-lived tokens, no refresh.
- GitLab OAuth: refresh tokens; `refreshTokenRouteName` not set →
  uses default flow.
- Bitbucket OAuth: refresh tokens; `refreshTokenRouteName: "bitbucket"`
  (`bundle:166679`) routes through GK proxy.
- Azure DevOps: PAT only — no refresh, expiry up to user.
- Jira Cloud: refresh tokens; `refreshTokenRouteName: "jira"`
  (`bundle:166840`).

`getIsTokenPAT` (`bundle:52674`):

```js
at.getIsTokenPAT = (Ve, at) => !dn.default.get([Ve, "refreshToken"], at);
```

Heuristic: presence of `refreshToken` in stored creds means OAuth;
absence means PAT (or never connected).

## Disconnect flow (`bundle:146602`)

```js
at.disconnectIntegration = (Ve, at) => ({
  saga: function* disconnectIntegrationSaga(ct) {
    yield put(ProtocolIntegrationConnectingUpdated(Ve, false));
    try {
      const ct = yield select(getCurrentProfileGuid);
      yield call(default, DISCONNECT_INTEGRATION, Ve, at);
      yield put(IntegrationCredentialsDeletedForCurrentProfile(ct, Ve));
    } catch (Ve) { /* showToast Error-DisconnectingServiceFailed */ }
  }
});
```

`DISCONNECT_INTEGRATION` IPC tells main to wipe the stored
credential. `at` is a "soft disconnect" boolean — when `true`
(used at `bundle:253426`'s "Retry without OAuth" button), main
keeps cached metadata but clears the token, allowing PAT fallback
without re-fetching the user profile.

## chajá deviation: direct OAuth, no proxy

Replace the GK proxy URL pattern with provider-native OAuth
authorize endpoints:

| Provider | chajá authorize URL |
|----------|---------------------|
| GitHub | `https://github.com/login/oauth/authorize?client_id=…&scope=…&redirect_uri=…&state=…` |
| GitLab | `https://gitlab.com/oauth/authorize?client_id=…&response_type=code&redirect_uri=…&scope=…&state=…` |
| Bitbucket | `https://bitbucket.org/site/oauth2/authorize?client_id=…&response_type=code` (BB doesn't take redirect_uri at authorize time — registered with the OAuth app) |
| Azure DevOps | `https://app.vssps.visualstudio.com/oauth2/authorize?client_id=…&response_type=Assertion&state=…&scope=…&redirect_uri=…` |
| Jira Cloud | `https://auth.atlassian.com/authorize?audience=api.atlassian.com&client_id=…&scope=…&redirect_uri=…&state=…&response_type=code&prompt=consent` |

Token-exchange + refresh URLs:

| Provider | Token URL |
|----------|-----------|
| GitHub | `https://github.com/login/oauth/access_token` |
| GitLab | `https://gitlab.com/oauth/token` |
| Bitbucket | `https://bitbucket.org/site/oauth2/access_token` |
| Azure DevOps | `https://app.vssps.visualstudio.com/oauth2/token` |
| Jira Cloud | `https://auth.atlassian.com/oauth/token` |

These are **not in the bundle** — chajá must register an OAuth app
per provider and store the client_id (and, where required, the
client_secret in the keyring).

## chajá note: redirect URI strategy

Two viable patterns for native apps:

A) **Custom protocol scheme** — register `chaja://` via Tauri
   protocol-handler, listen for `chaja://oauth/<provider>/callback?code=…`.
   Cross-platform but installation-time setup needed (Linux:
   `.desktop` file `MimeType=x-scheme-handler/chaja`).

B) **Localhost loopback** — spin up an ephemeral HTTP server on a
   random port (8000-9999), redirect to `http://127.0.0.1:<port>/callback`.
   Standard for desktop OAuth (RFC 8252 §7.3 recommends this).
   No installation-time setup, but providers must allow loopback
   redirect URIs in their app config.

GK uses A (`gitkraken://` deep links) per their published docs.
For chajá's MVP, B is simpler and works on all platforms with no
installer changes. **Rec: B.**

## chajá note: PKCE is mandatory

Native apps SHOULD NOT ship a client_secret. All five providers
support OAuth 2.0 PKCE (Proof Key for Code Exchange, RFC 7636).
GK's proxy hides the client_secret server-side; chajá doesn't have
that luxury, so **every authorize request must include
`code_challenge` + `code_challenge_method=S256`** and the token
exchange must include `code_verifier`. Skipping PKCE is a security
audit failure.
