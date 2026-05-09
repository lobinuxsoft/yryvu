# Token storage

GK persists integration tokens via a **two-layer secure storage**
abstraction in the main process. The renderer talks to it only via
IPC; raw tokens never enter the renderer process beyond the brief
window between OAuth callback and persist-call.

## The storage class (`bundle:229427`–`229452`)

A simple wrapper. Three constructor args + 5 methods:

```js
class {
  constructor(Ve, at, ct) {
    this.password = at;          // master password / app key
    this.secFilePath = ct;       // path to encrypted file
    this.store = Ve;             // backend (keytar-like API)
  }

  getSecureStorageKey() {
    return "GitKraken" + ("production" !== globalThis.mode ? `-${globalThis.mode}` : "");
  }

  deletePassword(Ve)        { return this.store.deletePassword(this.secFilePath, this.password, getKey(), Ve); }
  deleteAllPasswords()      { return this.store.deleteAllPasswords(this.secFilePath, this.password); }
  getPassword(Ve)           { return this.store.getPassword(this.secFilePath, this.password, getKey(), Ve); }
  hasDataAlreadyStored()    { return this.store.hasDataAlreadyStored(this.secFilePath, this.password); }
  setPassword(Ve, at)       { return this.store.replacePassword(this.secFilePath, this.password, getKey(), Ve, at); }
}
```

Note: `getPassword` and `setPassword` take a per-entry key
(`Ve` arg). The class is a multi-entry store, not a single secret.

## The service factory (`bundle:289057`)

```js
go = (await getSecureStorageService().getAppSecureStorage())
       .getPassword(kr.publicRepoDomainWhitelistKey)
       .then(Ve => dispatch(updatePublicRepoDomainWhitelist(Ve || [])));
```

`getSecureStorageService` is at `bundle:145480` and `bundle:180293`
(re-exported in two modules). `getAppSecureStorage()` returns the
class instance bound to a specific file path + master password.

> ⚠ unconfirmed — The ipcInvoke contract for the underlying
> `keytar`-like store is at `bundle:360342`–`360353` (renderer-side
> stubs):
>
> ```js
> [ipcInvoke(), 2, "deletePassword"]
> [ipcInvoke(), 2, "getPassword"]
> async deletePassword(Ve, at, ct, dt) {}
> async getPassword(Ve, at, ct, dt) {}
> ```
>
> So renderer → IPC → main; main holds the actual `keytar` /
> `safeStorage` calls. The exact main-process implementation is not
> in the renderer bundle — only its interface.

## Storage backends (inferred, requires extract verification)

GK uses one of three backends depending on platform:

> ⚠ unconfirmed — `keytar` and `electron.safeStorage` are not
> directly grep-able in `/tmp/gk-bundle-pretty.js` (they live in
> the main-process bundle, not renderer). Inferring from
> install-extracted dependencies and Electron norms:
>
> 1. **`keytar`** (npm, native node module wrapping libsecret /
>    Keychain / DPAPI). Dropped in newer Electron because of
>    abandonware; possibly replaced.
> 2. **`electron.safeStorage`** (`encryptString` / `decryptString`)
>    — Electron 15+ provides this. Uses libsecret on Linux, Keychain
>    on macOS, DPAPI on Windows.
> 3. **A bespoke encrypted file** at `secFilePath` — the constructor
>    takes a path argument, suggesting a fallback file when no OS
>    keychain is available (Linux without libsecret, etc.).
>
> The class signature (`secFilePath` + `password` + `store`) implies
> the **encrypted file is the primary** with the OS keychain only
> guarding the master password. To verify, search GK's
> `app.asar` after extraction for `keytar` / `safeStorage`.

## What yryvu should do

**Primary backend:** `keyring` crate (Rust). It abstracts:

| Platform | Backend |
|----------|---------|
| Linux | `secret-service` (libsecret via D-Bus) |
| macOS | Keychain Services |
| Windows | Windows Credential Manager |

One entry per `(profile_id, integration_type)` pair. Service name
`io.yryvu` (or whatever bundle id), account name
`<profile_guid>:<integration_type>`. Value: JSON-serialised
credential blob `{accessToken, refreshToken?, expiresAt?, scopes?}`.

**Fallback when keyring unavailable** (Linux without
gnome-keyring / kwallet, headless servers): a sidecar file at
`$XDG_DATA_HOME/yryvu/credentials.json.enc`, mode `0600`, encrypted
with a key derived from a user passphrase via Argon2id. Refuse to
write plain JSON — period.

> yryvu deviation: GK ships an encrypted-file backend out of the
> box with no user passphrase (the "password" in the constructor
> is some app-derived constant). That's bad opsec — anyone with
> the file gets the tokens. yryvu's fallback should require
> a real user passphrase, prompted on first launch and cached
> for the session.

## Token rotation / expiry

OAuth credentials store both `accessToken` and `refreshToken`.
`getIsTokenPAT` (`bundle:52674`) detects PAT vs OAuth by
`refreshToken` presence:

```js
at.getIsTokenPAT = (Ve, at) => !get([Ve, "refreshToken"], at);
```

Expiry handling (inferred from refresh-token saga at
`bundle:146545`): when an API call returns 401, GK fires
`refreshTokenForAuth(type, at)` which IPC-calls `REFRESH_TOKEN`. If
refresh succeeds, the new pair is persisted via the same
`SAVE_AUTH_DATA_FOR_INTEGRATION_TYPE` channel. If it fails,
`showRefreshTokenExpiredToast` (`bundle:85842`) fires and the user
is prompted to reconnect.

`expiresAt` is **not stored separately** — GK relies on 401
detection rather than proactive expiry tracking. Simpler, but
costs one wasted API call per expired session.

> yryvu note: store `expiresAt` when the provider returns
> `expires_in` so yryvu can refresh proactively (e.g. 5 minutes
> before expiry) and avoid the cold-start 401. Cheap improvement.

## Per-profile multi-tenancy

Credentials key includes `getCurrentProfileGuid` (`bundle:203622`,
`bundle:146626`). The flow on disconnect:

```js
const ct = yield select(getCurrentProfileGuid);
yield call(default, DISCONNECT_INTEGRATION, Ve, at);
yield put(IntegrationCredentialsDeletedForCurrentProfile(ct, Ve));
```

— scoped to the active profile only. Multi-profile is GK's answer to
"two GitHub accounts": each profile has its own integration table.

yryvu: same model. The keyring-account-name pattern
`<profile_guid>:<integration_type>` lets yryvu list "all credentials
for profile X" via the keyring's `find_credentials` API.

## Token-metadata table (`bundle:203620`)

Separate from the actual tokens, GK keeps a non-sensitive metadata
table keyed similarly:

- `getIntegrationAccessTokenMetadata`
- `getIntegrationAccessTokenMetadataForCurrentProfile`

Contains things like *when* the token was last refreshed, scopes
last seen, last `eTag` fetched. Stored in profile settings (not
encrypted) so the renderer can introspect "is this token stale"
without round-tripping through IPC.

`getETags` (`bundle:203620`) is the related E-Tag cache for HTTP
If-None-Match optimisation — saves API rate-limit budget.

## yryvu deviation: separate keyring entries per credential

GK serialises everything into one JSON blob per integration. yryvu
should consider one entry per atomic secret:

| Account | Value |
|---------|-------|
| `<profile>:<provider>:access_token` | the access token |
| `<profile>:<provider>:refresh_token` | the refresh token |

Pros: easier rotation, cheaper updates (only the changed entry
re-writes), easier introspection via OS tools.

Cons: more entries, more keyring API calls.

**Rec:** match GK's blob pattern (one entry per provider) for v1;
revisit only if rotation becomes a hot path.

## yryvu note: never log tokens

The Octokit error wrapper (`bundle:46153`–`46154`) redacts tokens
from logs:

```js
ct.request.headers.authorization.replace(/(?<! ) .*$/, " [REDACTED]")
dt.url.replace(/\bclient_secret=\w+/g, "client_secret=[REDACTED]")
      .replace(/\baccess_token=\w+/g, "access_token=[REDACTED]")
```

Mirror this in yryvu's HTTP client error formatter. Bake it into the
shared error type so it's impossible to accidentally print a token
from any log path. Bonus: include the redaction in `Display` impl
of the error type, not just `Debug`.
