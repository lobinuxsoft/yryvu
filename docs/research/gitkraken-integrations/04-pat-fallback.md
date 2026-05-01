# PAT (Personal Access Token) entry path

PAT entry is the universal fallback. Even providers whose primary
`authType` is `OAUTH` accept PAT input via the same dialog
machinery (`handleManualIntegrationTokenInput` at `bundle:146636`).

## When PAT is the *only* mode

Providers with `authType: "PAT"` or `"USERNAME_AND_PASSWORD"` from
the master table:

| Provider | `authType` | `generateTokenPath` |
|----------|-----------|---------------------|
| `githubEnterprise` | `PAT` | `/settings/tokens/new` |
| `gitlabSelfHosted` | `PAT` | `/-/user_settings/personal_access_tokens` |
| `bitbucketServer` | `PAT` | `/account` |
| `azureDevops` | `PAT` | `/_usersSettings/tokens` |
| `jiraServer` | `USERNAME_AND_PASSWORD` | `/secure/ViewProfile.jspa` (for PAT setup) |

For these, the Connect button does **not** trigger OAuth — instead
it opens the credential prompt form.

## When PAT is offered as fallback

For OAuth-primary providers, the PAT fallback surfaces in two
places:

1. The Preferences > Integrations sub-tab itself — the connect
   form (re-used component) renders both an "Authorize via OAuth"
   button and a "Paste a token" text input.
2. The Git-credentials prompt at `bundle:253448`–`253520`
   (`showCredentialPrompt`) — when a `git push` / `git fetch`
   prompts for credentials, GK detects the hosting service and
   offers three options:
   - `connect-integration` → opens Integrations preferences
     (`PromptForCreds-ConnectIntegrationLink`)
   - `use-pat` → continues to a PAT input field
     (`PromptForCreds-UsePersonalAccessToken` /
     `PromptForCreds-UseAppPassword` for Bitbucket /
     `PromptForCreds-UseUsernameAndPassword` for unknowns)
   - `cancel`

The label is provider-aware (`bundle:253478`–`253485`):

```js
let at = "PromptForCreds-UseUsernameAndPassword";
switch (mn) {
  case na.integration_pat:
    at = "PromptForCreds-UsePersonalAccessToken"; break;
  case na.integration_app_password:
    at = "PromptForCreds-UseAppPassword";
  case na.integration_user_pass:
}
```

The Bitbucket-specific "App Password" relabel is driven by
`PATsAreCalledAppPasswords: true` (`bundle:166682`).

## The "Generate Token" deep-link (`bundle:146668`)

The Connect dialog has a button that opens the provider's PAT-creation
page in the system browser, with scopes pre-selected:

```js
at.openLinkToGenerateToken = (Ve, at, ct) => ({
  saga: function* openLinkToGenerateTokenSaga(dt) {
    const { generateTokenPath, oldGenerateTokenPath, generateTokenParams }
      = $n.integrationInfo[at];
    const { host, path, protocol } = parsedUrl;
    const An = ct ? oldGenerateTokenPath : generateTokenPath;
    if (!An || !host || !path) return;
    let Dn = "";
    Dn = at === AZURE_DEVOPS && protocol
      ? getUrlForAzure(protocol, host, getMaybeOrganizationNameFromAzureDevOpsUrl(Ve))
      : urlSlashJoin(`${protocol}//`, host, path);
    const Fn = generateTokenParams ? `?${generateTokenParams}` : "";
    const jn = `${urlSlashJoin(Dn, An)}${Fn}`;
    yield dt.call(openExternal, jn);
  }
});
```

Three args:

- `Ve` — the provider's host URL (the user's GHE base URL, GitLab
  self-hosted instance URL, etc.).
- `at` — the integration type.
- `ct` — `true` if old path should be used (for older self-hosted
  versions). UI passes this from the "use legacy URL" toggle.

## Per-provider PAT scopes

The bundle contains explicit scope hints only for GitHub Enterprise
(`bundle:166446`):

```
generateTokenParams: "scopes=repo,admin:org,admin:public_key,workflow&description=GitKraken"
```

For the rest, the user lands on the bare `/personal_access_tokens`
page and ticks scopes themselves. chajá should **append scope
querystrings for every PAT-using provider**:

| Provider | Suggested PAT scopes (chajá-built querystring) |
|----------|------------------------------------------------|
| GitHub Enterprise | `repo,admin:org,admin:public_key,workflow` (matches GK) |
| GitLab Self-Managed | `api,read_user,read_repository,write_repository` |
| Bitbucket DC | (no scope querystring — DC PAT page picks them) |
| Azure DevOps | `vso.code_full,vso.work_full,vso.profile` |
| Jira Server | (DC PAT page picks them) |

## The credential dialog UI

For `azureDevops` specifically (`bundle:253363`–`253406`), the form
renders **two buttons + one text input + cancel**:

- "Generate Token" button — fires `openLinkToGenerateToken`
- A `<input type="text">` for the user to paste the PAT
- "Submit" button — fires
  `saveAuthDataForIntegrationType(AZURE_DEVOPS, { credentials:
  { accessToken: <typed> }, url: <azure org url> })`
- Cancel

For non-Azure (`bundle:253407`–`253433`), the same prompt slot
shows simpler buttons:

- `RefreshTokenLabel` — re-runs OAuth via `reconnectService(Ve)`
- `RetryWithoutOAuthLabel` — soft-disconnects so PAT can be entered
- Cancel

## i18n keys (the catalogue chajá must clone)

From `bundle:150413`–`150506` and `bundle:228226`–`228366` and
`bundle:253489`–`253613`:

| Key | Where used |
|-----|-----------|
| `PromptForCreds-EnterCredentialsForUrl` | dialog title |
| `PromptForCreds-InvalidCredentialsForUrl` | dialog title (after a failure) |
| `PromptForCreds-UsernamePlaceholder` | username input placeholder |
| `PromptForCreds-PasswordPlaceholder` | password input placeholder |
| `PromptForCreds-PersonalAccessTokenPlaceholder` | token input placeholder (PAT mode) |
| `PromptForCreds-AppPasswordPlaceholder` | token input placeholder (Bitbucket) |
| `PromptForCreds-RememberMe` | "remember me" checkbox label |
| `PromptForCreds-PleaseLogInGeneric` | generic prompt body |
| `PromptForCreds-PleaseLogInToService` | service-specific body (templated) |
| `PromptForCreds-InvalidLoginGeneric` | failure body, generic |
| `PromptForCreds-InvalidLoginForService` | failure body, service-specific |
| `PromptForCreds-PromptForCredsChoice` | three-button choice prompt body |
| `PromptForCreds-InvalidLoginPromptForCredsChoice` | same, after a failure |
| `PromptForCreds-ConnectIntegrationLink` | "Connect Integration" button |
| `PromptForCreds-UseUsernameAndPassword` | "Use User/Pass" button |
| `PromptForCreds-UsePersonalAccessToken` | "Use PAT" button |
| `PromptForCreds-UseAppPassword` | "Use App Password" button |
| `PromptForCreds-EnterUsername` / `PromptForCreds-EnterUsernameInvalid` | username-only prompt body |
| `PromptForCreds-EnterSSHPassphrase` / `PromptForCreds-EnterServiceSSHPassphrase` | SSH-key passphrase prompt |
| `PromptForCreds-IncorrectSSHPassphrase` / `PromptForCreds-IncorrectServiceSSHPassphrase` | retry after wrong passphrase |
| `PromptForCreds-LocksIcon` | lock icon tooltip |
| `PromptForCreds-EnterPasswordForUrlWithUsername` | password-only prompt with known username |
| `PromptForCreds-GpgPassphrase` | GPG-signing passphrase |

Implement the i18n bundle one-to-one — keys, not strings, for
greppability.

## chajá deviation: drop "Username & Password" except for Jira Server

GitHub disabled password auth for the API in 2020. Bitbucket
likewise. The `USERNAME_AND_PASSWORD` mode is effectively dead for
all GK providers except Jira Server, but GK still includes it in
`authTypes` (`bundle:201657`) for legacy installs.

chajá v1: only render the user/pass form for Jira Server. For
everything else, the third button (`use-pat`) is the primary,
not a fallback. Skip the `connect-integration` middle button if
chajá's UX makes Integrations preferences a top-level shortcut
(see `07-connection-required-prompts.md`).

## chajá note: PAT validation = preflight API call

After `saveAuthDataForIntegrationType`, GK fires
`INTEGRATION_API_PREFLIGHT` IPC (`bundle:166972`). Main process
does an authenticated request (typically `GET /user` for GitHub,
`/api/v4/user` for GitLab, `/2.0/user` for Bitbucket,
`/_apis/profile/profiles/me` for Azure, `/myself` for Jira) to
validate the token before treating it as connected.

If preflight fails, the error flows through
`handleVerifyIntegrationCredentialsFailed` (`bundle:146564`) which
maps a few well-known error messages:

| Server message | Toast key |
|----------------|-----------|
| `CAPTCHA_VERIFICATION_ERROR` | `buildCaptchaLoginMessage(at.loginUrl)` |
| `SAVE_CREDS_HOST_UNREACHABLE` | `Services-Error-HostDomainUnreachable` |
| `TOKEN_SCOPE_INVALID_ERROR` | `ErrorMessage-InvalidScopes` (with provider label) |
| (anything else) | `Services-Error-TokenInvalid` |

Plus a top-level title `Services-Error-SaveAuthDataFailed`.
SSL errors get their own toast via `showSSLCertErrorToast`
(`bundle:85765`). See `08-error-states.md`.
