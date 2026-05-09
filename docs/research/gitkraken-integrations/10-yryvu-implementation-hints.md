# yryvu implementation hints

This doc is yryvu-side synthesis — translating the audit's findings
into the yryvu stack (Rust backend via Tauri 2 + SolidJS renderer).
**Not** sourced from the GK bundle; this is the audit's
recommendations for how to land the surface.

Cross-reference with `docs/architecture/` if/when yryvu grows that
tree.

## Crate structure

Suggested Rust split:

```
crates/
  yryvu-bridge/
    src/
      integrations/
        mod.rs                 ← public API (trait IntegrationProvider)
        provider_table.rs      ← static array of IntegrationProvider records
        types.rs               ← shared types (AuthType, Hostname, …)
        keyring.rs             ← keyring-crate wrapper + sidecar fallback
        oauth/
          mod.rs               ← PKCE state machine + loopback server
          github.rs            ← per-provider authorize/token URLs + scopes
          gitlab.rs
          bitbucket.rs
          azure.rs
          jira.rs
        api/
          mod.rs               ← preflight + GET_USER per provider
          github.rs            ← Octocrab wrapper
          gitlab.rs
          bitbucket.rs
          azure.rs
          jira.rs
        ipc.rs                 ← Tauri command handlers (mirror GK's IPC channels)
```

Each per-provider file < 400 LOC. If `oauth/github.rs` blows past
400, split into `oauth/github/{authorize.rs,token.rs,refresh.rs}`.

## Tauri command surface (mirror GK's IPC channel names)

```rust
#[tauri::command] async fn send_authorization_request(integration_type: IntegrationType) -> Result<()>;
#[tauri::command] async fn save_auth_data_for_integration_type(integration_type: IntegrationType, data: AuthData) -> Result<UserInfo>;
#[tauri::command] async fn remove_auth_token_for_integration_type(integration_type: IntegrationType) -> Result<()>;
#[tauri::command] async fn disconnect_integration(integration_type: IntegrationType, soft: bool) -> Result<()>;
#[tauri::command] async fn refresh_token(integration_type: IntegrationType, retry_count: u8) -> Result<()>;
#[tauri::command] async fn get_user(integration_type: IntegrationType) -> Result<Option<UserInfo>>;
#[tauri::command] async fn integration_api_preflight(integration_type: IntegrationType) -> Result<()>;
#[tauri::command] async fn refresh_integration_data(integration_type: IntegrationType) -> Result<()>;
```

Same names, snake-cased. Makes cross-referencing the GK bundle
trivially easy six months from now.

## SolidJS component layout

```
apps/yryvu-app/src/components/Preferences/
  Integrations/
    IntegrationsTab.tsx           ← top-level Preferences > Integrations
    IntegrationsSubTabSidebar.tsx ← left rail listing 10 providers (orderedIntegrationSubTabTypes)
    IntegrationsSubTabContent.tsx ← right pane router (per provider)
    IntegrationConnectionForm.tsx ← reusable account-row component (mirrors bundle:165616)
    IntegrationStatusPill.tsx     ← Connected / Not Connected / Connecting
    IntegrationUserInfo.tsx       ← avatar + name + username block
    IntegrationSslWarning.tsx     ← SSL cert error inline panel
    IntegrationConnectButton.tsx  ← connect/refresh dispatch + onMouseDown
    IntegrationDisconnectButton.tsx
    JiraCloudResourcesPicker.tsx  ← only Jira Cloud's accessible-resources sub-UI
    GitHubEnterpriseHostnameForm.tsx  ← custom-hostname field for self-hosted variants
    GitLabSelfHostedHostnameForm.tsx
    BitbucketServerHostnameForm.tsx
    AzureDevopsOrgForm.tsx
  PreferencesTabSidebar.tsx        ← top-level "Integrations" entry lives here
```

Each component < 200 LOC. The reusable `IntegrationConnectionForm`
takes `integrationType` as prop and reads the per-type config from
the provider-table store — don't fork into per-provider components.

## Inline-CTA components

```
apps/yryvu-app/src/components/
  CallToActions/
    HostingServiceNotConnected.tsx  ← PR slidey-panel empty state (data-testid="hosting-service-not-connected")
    IssueTrackerNotConnected.tsx    ← LeftPanel ISSUES section stub
    ConflictDetectionConnectIntegration.tsx
    NewTabConnectIntegrationsWidget.tsx
```

Every CTA imports the same `useOpenIntegrationPreferences(provider)`
hook so the dispatch is uniform:

```typescript
function useOpenIntegrationPreferences() {
  const navigate = useNavigate();
  return (provider: IntegrationType, telemetryAction?: string) => {
    // yryvu's TargetBranchStatusAction-equivalent enum tag
    navigate(`/prefs/integrations/${getSubTabType(provider)}`);
  };
}
```

## State machine

Per-integration state is a small finite-state machine:

```
disconnected → connecting → connected
connected    → refreshing → connected
connecting   → connect_failed (toast) → disconnected
refreshing   → refresh_failed (toast) → disconnected
connected    → disconnecting → disconnected
```

Use a discriminated union in the SolidJS store:

```typescript
type IntegrationState =
  | { tag: "disconnected"; reason?: "user_initiated" | "token_revoked" | "refresh_failed" }
  | { tag: "connecting" }
  | { tag: "connected"; user: UserInfo; tokenMetadata: TokenMetadata }
  | { tag: "refreshing"; previous: UserInfo }
  | { tag: "disconnecting" };
```

Don't use a flat `isConnected: boolean + isConnecting: boolean +
isRefreshing: boolean` — that's the mistake every codebase makes
in v1 and regrets in v3.

## Persistence (mirror GK's keys)

| Storage | Path/Key | Content |
|---------|----------|---------|
| Keyring | service `io.yryvu.integrations`, account `<profile_guid>:<integration_type>` | JSON `{accessToken, refreshToken?, expiresAt?, scopes?}` |
| Keyring fallback | `$XDG_DATA_HOME/yryvu/credentials.<profile>.enc` (mode 0600, Argon2id-derived key) | same JSON, encrypted |
| Profile settings | `integrations.<type>.userInfo` | UserInfo cache (rehydrated on launch) |
| Profile settings | `integrations.<type>.lastRefreshAt` | timestamp |
| Profile settings | `integrations.<type>.scopesGranted` | string[] |
| Profile settings | `integrations.<type>.eTags` | E-Tag map for HTTP If-None-Match |
| Profile settings | `integrations.<type>.customHostname` | for self-hosted variants only |
| Profile settings | `integrations.<type>.sslWhitelist` | per-host accept-invalid-cert toggle |

## OAuth: PKCE + loopback server (per `03-oauth-flow.md` rec)

```rust
// Pseudocode
async fn start_oauth(provider: IntegrationType) -> Result<()> {
    let code_verifier  = generate_code_verifier();   // 43-128 chars
    let code_challenge = sha256_b64url(&code_verifier);
    let state          = random_b64url(32);
    let port           = bind_loopback_listener()?;  // ephemeral
    let redirect_uri   = format!("http://127.0.0.1:{}/callback", port);

    let url = build_authorize_url(provider, &state, &code_challenge, &redirect_uri);
    tauri_plugin_shell::open(url).await?;            // system browser

    let (code, returned_state) = await_callback(port).await?;
    if returned_state != state { return Err(StateMismatch); }

    let creds = exchange_code(provider, &code, &code_verifier, &redirect_uri).await?;
    keyring_save(profile_guid(), provider, &creds).await?;
    let user = preflight_get_user(provider, &creds.access_token).await?;
    profile_settings_set("userInfo", user)?;
    Ok(())
}
```

Loopback server uses `tiny_http` or hyper-simple, lifetime bound
to the OAuth call (drop after callback). Listen only on
`127.0.0.1`, never `0.0.0.0`.

## i18n

Mirror GK's i18n keys from docs 04, 05, 07, 08 verbatim. Drop into
`apps/yryvu-app/src/i18n/en.json` (and ES, since the user is
ES-tuteo). yryvu-side translations are the user's call — but the
**keys** are stable cross-references back to the bundle.

## Testing

End-to-end tests for OAuth are notoriously flaky (live providers,
real consent screens). yryvu-side strategy:

- **Mock provider**: ship a `yryvu-test-oauth-provider` crate that
  serves an OAuth-2.0-compliant authorize/token endpoint pointed
  at the yryvu app. Tests run against this, not real providers.
- **Provider client tests**: per-provider unit tests against
  `wiremock` fixtures captured from real provider responses
  (sanitised). Stable and fast.
- **Visual regression**: Playwright screenshot tests of every
  Preferences > Integrations sub-tab, in both connected and
  disconnected states, with a fixed-seed user (avatar, name,
  username) so screenshots don't drift.
- **`data-testid` selectors**: `connect-integration-button`,
  `integration-connection-status`, `hosting-service-not-connected`
  — verbatim from GK's bundle so tests have the same hooks.

## Order of implementation

1. **Provider table + types** (one PR). No UI yet, just the static
   data + IntegrationType enum + AuthType enum.
2. **Keyring wrapper + sidecar fallback** (one PR). Tested
   standalone.
3. **OAuth state machine + PKCE + loopback server** (one PR).
   Tested against the mock provider crate.
4. **Per-provider OAuth configs** (one PR per provider, in order:
   GitHub → GitLab → Bitbucket → Azure → Jira Cloud).
5. **Per-provider preflight API client** (one PR per provider).
6. **Preferences > Integrations UI** (one PR). Mirrors
   `IntegrationConnectionForm` shape from bundle:165616. Skeleton
   wiring only — no providers yet.
7. **Inline CTAs** (one PR per CTA, in priority order: PR slidey
   panel → conflict-detection popover → ISSUES stub → NewTab
   widget).
8. **Error toasts** (one PR). All 8 toast variants from `08-error-states.md`.
9. **PAT fallback dialog** (one PR). Builds on the same
   `saveAuthDataForIntegrationType` IPC.
10. **Self-hosted hostname forms** (one PR per provider variant:
    GHE → GitLab self-hosted → BBS → Jira Server).

Each step yields a working partial product. No 6-month
"refactor everything when we're done" merge.

## yryvu note: don't ship telemetry

GK's `recordMetric(metric, { additionalPayload })` calls fire on
every CTA. yryvu doesn't ship telemetry — but **do** keep the
`TargetBranchStatusAction`-equivalent enum for typed dispatch. It's
the right shape for "which CTA fired this" debugging even without
analytics.

## yryvu note: provider OAuth app registrations

Before any of this ships, someone has to register yryvu's OAuth
apps with each provider:

- **GitHub**: Settings → Developer settings → OAuth Apps → New
- **GitLab**: User Settings → Applications → Add new application
- **Bitbucket**: Workspace settings → OAuth consumers → Add consumer
- **Azure DevOps**: aex.dev.azure.com → Profile → Authorize
  applications (or organisation-level)
- **Jira Cloud**: developer.atlassian.com → Console → Create app

Each registration captures: client_id, redirect_uri (loopback or
custom protocol), allowed scopes, branding (icon + name "yryvu").
Document the values in `docs/ops/oauth-app-registrations.md`
(off-tree if secrets, on-tree if just IDs).

This is a **one-time-per-provider** task — the values get baked
into yryvu's compile-time config and ship with the binary.
