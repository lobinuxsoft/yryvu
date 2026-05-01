# Error states

The full taxonomy of integration-error UX. Every entry is a toast
or inline panel, sourced from `bundle:85700`–`85900` (the
toast-saga module) plus `bundle:146564` (the credential-failure
saga).

## The standard error-toast shape

All integration errors use the toast variant `toastVariants.ERROR`
with these defaults (`bundle:85787`+):

```
variant:    toastVariants.ERROR
dismissable: lr.X_ONLY            ← only the X dismisses; click-anywhere does NOT
duration:   lr.TOAST_DURATION_FOREVER
toastId:    getToastIdFromTitleAndContent(title, content)  ← dedupe key
```

Mirror the dedupe key — without it, a 401 cascade can stack 30
identical toasts.

## 1. Auth failed during initial connect (`bundle:146564`)

`handleVerifyIntegrationCredentialsFailed(integrationType, error)`.
Maps server-side error messages to user-facing translations:

| Server error | User-facing translation key | Body content |
|--------------|-----------------------------|--------------|
| `CAPTCHA_VERIFICATION_ERROR` | (built dynamically) | `buildCaptchaLoginMessage(error.loginUrl)` — clickable link to provider's CAPTCHA-completion page |
| `SAVE_CREDS_HOST_UNREACHABLE` | `Services-Error-HostDomainUnreachable` | (just the title) |
| `TOKEN_SCOPE_INVALID_ERROR` | `ErrorMessage-InvalidScopes` (templated with provider label) | `buildLoginToServiceMessage(...)` — re-prompts with login link |
| (default) | `Services-Error-TokenInvalid` | (just the title) |

Top-level toast title is always `Services-Error-SaveAuthDataFailed`.

## 2. SSL cert error (`bundle:85765`)

```js
at.showSSLCertErrorToast = (Ve, at) => ({
  saga: function* showSSLCertErrorToastSaga(ct) {
    yield ct.call(showToast, {
      variant: toastVariants.ERROR,
      title: translate("Error-InvalidSSLCert"),
      content: createElement(buildSSLCertErrorMessage, {
        integrationType: Ve,
        sslErrorMessage: at
      }),
      ...
    });
  }
});
```

`Ve` = integration type, `at` = the SSL error message string.
Title key: `Error-InvalidSSLCert`. Content is a dedicated React
component (not pure i18n) because it needs to render a
clickable "Add to SSL whitelist" button.

The same component re-renders **inline** in the connection panel
when `hasInvalidSSLCert: !isEmpty(getInvalidSSLCertsByIntegrationType(state)[type])`
(`bundle:165712`).

## 3. "Need upgraded permissions" (scope-insufficient) (`bundle:85700`–`85740`)

Title: `Error-NeedUpgradedPermissions`.
Body: `ErrorMessage-NeedUpgradedPermissions` (templated with provider).
Button: `ErrorMessage-NeedUpgradedPermissionsButton` →
`openPreferenceView(INTEGRATIONS, sub-tab)` + close toast.

Fires when an API call returns a scope-insufficient error (e.g.
the user authorised with `repo` only, but a feature needs
`admin:org`). The toast deep-links to Preferences so the user can
reconnect with broader scopes.

## 4. Login required (provider rejected token) (`bundle:85783`)

`showLoginToProviderToast(integrationType, title, content, telemetryKey)`.
Generic shape — title and content are caller-provided. The button:

```js
{
  variant: "default",
  label: translate("ErrorMessage-refreshIntegrationButton", friendlyName),
  onClick: at => {
    at(openPreferenceView(INTEGRATIONS, subTab));
    closeToast();
    Ve && at(sendAuthorizationRequest(Ve));   // ← also re-fires authorize
  }
}
```

Note: clicking the button **opens prefs AND immediately re-fires
auth**, not just opens prefs. So one click → user is back in OAuth.

## 5. Refresh token expired (`bundle:85842`)

```js
at.showRefreshTokenExpiredToast = Ve => ({
  saga: function* (at) {
    if ("google" === Ve || "sso" === Ve) return;     // out of scope
    const friendly = getFriendlyIntegrationNameFromType(Ve);
    const subTab = getIntegrationsSubTabTypeFromIntegrationName(Ve);
    const title = translate("ErrorMessage-XRefreshTokenExpired", friendly);
    yield at.call(showToast, {
      variant: ERROR,
      title,
      buttons: [{
        label: translate("ErrorMessage-reconnectIntegrationButton", friendly),
        onClick: Ve => { Ve(openPreferenceView(INTEGRATIONS, subTab)); closeToast(); }
      }],
      dismissable: X_ONLY,
      duration: TOAST_DURATION_FOREVER,
      toastId: getToastIdFromTitleAndContent(title, null)
    });
  }
});
```

Title (templated): `ErrorMessage-XRefreshTokenExpired`.
Button: `ErrorMessage-reconnectIntegrationButton`.

The `toastId` is just from the title — so multiple
"refresh-expired" toasts for the same provider dedupe to one
visible row. Mirror that.

## 6. SSH key being used for unmodifiable service (`bundle:85743`)

Adjacent informational toast. Not an error per se — just notes
that the user's SSH key is in use by a provider that doesn't expose
SSH-key management API (e.g. Bitbucket DC with
`supportsSSHModification: false`).

Variant: `INFO` (not error). Title: `Notification-SSHKeyBeingUsed`.
Body: `NotificationMessage-SSHKeyBeingUsed` templated.
Button (when manage-URL provided): `Notification-ManageSSHKeysButton`
opens the provider's SSH-management page in the browser.

## 7. Disconnect failure (`bundle:146608`)

Inside `disconnectIntegration` saga:

```js
catch (Ve) {
  const at = translate("Error-DisconnectingServiceFailed");
  yield ct.spawn(showToast, {
    variant: ERROR,
    title: at,
    content: Ve.message,
    telemetry: { message: "Error-DisconnectingServiceFailed" }
  });
}
```

Title: `Error-DisconnectingServiceFailed`. Body: raw error message
from main process. No CTA button.

## 8. Token-save failed (couldn't persist) (`bundle:146657`)

Inside `handleManualIntegrationTokenInput`:

```js
catch (Ve) {
  const t = select(getTranslationFn);
  const ct = t("ErrorMessage-CouldNotSaveToken");
  const dt = t("ErrorMessage-PleaseVerifyToken");
  yield put(showToast({
    variant: ERROR,
    title: ct,
    content: dt,
    telemetry: { message: "ErrorMessage-CouldNotSaveToken" }
  }));
}
```

Title: `ErrorMessage-CouldNotSaveToken`.
Body: `ErrorMessage-PleaseVerifyToken`.
No button — user retries via the still-open dialog.

## 9. Rate-limited UX

> ⚠ unconfirmed — There's no dedicated "rate limited" toast in the
> integration sagas. Provider 429 responses are likely surfaced via
> the generic auth-failed path with the provider's own error
> message in `Ve.message`.
>
> Octokit's error wrapper at `bundle:46193` does preserve `status:
> 500` for thrown errors but doesn't differentiate 429. Worth
> adding in chajá: detect `status === 429`, parse `Retry-After`,
> show a `RateLimited-X` toast with cooldown countdown.

## 10. Network failure / host unreachable

Falls into `SAVE_CREDS_HOST_UNREACHABLE` (`bundle:146575`):

```js
case $n.SAVE_CREDS_HOST_UNREACHABLE:
  dt = translate("Services-Error-HostDomainUnreachable");
  break;
```

Surfaces inside the credential-prompt failure path. No retry button —
the user has to fix their network and re-submit.

The `apiErrorMap` (`bundle:201670`) covers a few specific provider
error strings:

```js
at.apiErrorMap = {
  "key is already in use": "Error-KeyAlreadyExistsOnAccount",
  "Please upgrade your plan to create a new private repository.": "Error-GitHubNoMorePrivateRepos",
  "name already exists on this account": "Error-RepoAlreadyExistsOnAccount"
};
```

These map provider-error-message → translation-key for the
repo-creation flow specifically. Niche, but mirror for parity.

## i18n key catalogue (errors)

| Key | Where | Severity |
|-----|-------|----------|
| `Error-InvalidSSLCert` | toast title | error |
| `Error-NeedUpgradedPermissions` | toast title | error |
| `ErrorMessage-NeedUpgradedPermissions` | toast body | error |
| `ErrorMessage-NeedUpgradedPermissionsButton` | toast button | (action) |
| `ErrorMessage-refreshIntegrationButton` | toast button (login) | (action) |
| `ErrorMessage-reconnectIntegrationButton` | toast button (refresh expired) | (action) |
| `ErrorMessage-XRefreshTokenExpired` | toast title (templated) | error |
| `ErrorMessage-CouldNotSaveToken` | toast title | error |
| `ErrorMessage-PleaseVerifyToken` | toast body | error |
| `ErrorMessage-InvalidScopes` | toast body | error |
| `Services-Error-HostDomainUnreachable` | dialog body | error |
| `Services-Error-SaveAuthDataFailed` | toast title | error |
| `Services-Error-TokenInvalid` | toast body | error |
| `Error-DisconnectingServiceFailed` | toast title | error |
| `Error-KeyAlreadyExistsOnAccount` | mapped from provider 4xx | error |
| `Error-GitHubNoMorePrivateRepos` | mapped from provider 4xx | error |
| `Error-RepoAlreadyExistsOnAccount` | mapped from provider 4xx | error |
| `Notification-SSHKeyBeingUsed` | toast title | info |
| `NotificationMessage-SSHKeyBeingUsed` | toast body | info |
| `Notification-ManageSSHKeysButton` | toast button | (action) |

## chajá deviation: error variants by category

GK uses just two variants — `INFO` and `ERROR`. SolidJS toast
libraries usually offer four (`info`, `success`, `warning`,
`error`). Stick to two for parity unless a specific case really
needs warning (network-flaky retry loop, e.g.).

## chajá note: never auto-dismiss integration errors

Every integration error in GK has `duration: TOAST_DURATION_FOREVER`.
This is correct — these errors block real workflow. An auto-dismiss
3-second toast that disappears while the user is making coffee
costs them the diagnostic info. **Mirror exactly.** It's not the
default behaviour of every toast lib; check chajá's choice.

## chajá note: telemetry message ≠ user message

GK's `telemetry.message` field is the **i18n key** (e.g.
`"ErrorMessage-CouldNotSaveToken"`), used as a stable identifier
for analytics, not the rendered string. chajá doesn't have
analytics but **still log the i18n key on every error** — it's the
fastest grep target when triaging bug reports ("user says they got
'could not save token' — what saga dispatched that?").
