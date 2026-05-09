# 09 — Error classes + UI presentation

This doc enumerates onboarding-flow errors, their GK presentation, and
the yryvu typed-error mapping for v1.

## Error catalogue

### Clone

| Error class | Trigger | GK presentation |
|---|---|---|
| `CloneRepo-CloneFailed` (generic) | Any unhandled exception during clone | Error toast (`bundle:188708`), title = generic key, content = err.message |
| `CloneRepo-CloneFailed` + reconnect button | `maybeOrgOwner` flag set on credential rejection (org-required scopes) | Error toast with custom button "Reconnect to <Provider>" (`bundle:188713-188729`) |
| `Notification-CloneFailed-DestinationExists` | (inferred — bundle key search-pattern) Destination directory exists and is non-empty | Error toast |
| SSL cert error | `checkIfErrorIsSSLError(err)` returns true | `showSSLCertErrorToast` with "Trust certificate" button (`bundle:43904`) |
| `LOCAL_PATH_AND_URL_REQUIRED` | Submit with empty path or URL | Error thrown synchronously (`bundle:188497`) |

### Init

| Error class | Trigger | GK presentation |
|---|---|---|
| `Error-CreateRemoteRepoFailed` (sic) / `Error-CreateLocalRepoFailed` (telemetry) | Any error during `createRepo` saga | Error toast (`bundle:202856`), title = generic key, content = err.message |
| `Error-CouldNotWriteToRepo` | `setUpInitialCommitFiles` filesystem write failed | Thrown inside the saga, surfaces to the createRepo catch block (`bundle:132619`) |
| `LOCAL_PATH_REQUIRED` | Empty `localPath` | Synchronous throw in saga (`bundle:202836`) |
| Default-branch invalid | `onValidateDefaultBranchRow` returns truthy | Inline form error `InitRepo-InvalidDefaultBranchName` (`bundle:53891`, `bundle:82175`) |
| GPG sign guard fails | `guardGpgSignMessage` rejects | Synchronous throw, surfaces as toast |
| Concurrency: another create / clone in flight | `getIsCreatingRepo \|\| getIsCloningInProgress` | Saga returns silently (`bundle:202828` `if (An \|\| Dn) return;`) |

### Open

The Open form has minimal error surface. Path validity is checked by
`RepoPathSelector` before the button enables. If the user manually types
a path and presses Enter, libgit2 attempts to open and any failure
surfaces as a generic "could not open repository" toast.

## yryvu typed errors for v1

Add to `crates/yryvu-bridge/src/repo/backend/errors.rs` (or wherever
the existing error enum lives):

```rust
pub enum BackendError {
    // ... existing variants ...

    // Clone
    CloneAuthRequired { host: String },
    CloneAuthFailed   { host: String, message: String },
    CloneSslError     { host: String, message: String },
    CloneNetworkError { message: String },
    CloneDestinationExists { path: String },
    CloneInvalidUrl   { url: String },
    CloneCancelled    { session_id: String },
    CloneFailed       { message: String }, // catch-all

    // Init
    InitDestinationNotEmpty { path: String },
    InitInvalidBranchName   { branch: String },
    InitTemplateNotFound    { kind: String, key: String }, // "gitignore" | "license"
    InitFailed              { message: String },

    // Validate-path (used by future Open-form refactor)
    NotAGitRepository { path: String },
}
```

These should map cleanly from gix errors. For example:

```rust
match gix::open(&path) {
    Err(gix::open::Error::NotARepository { .. }) =>
        Err(BackendError::NotAGitRepository { path: path.into() }),
    Err(other) =>
        Err(BackendError::Internal(other.to_string())),
    Ok(repo) => Ok(repo),
}
```

For clone, gix-protocol surfaces auth errors via
`gix::credentials::protocol::Error` and SSL via
`gix_transport::client::Error`. Map both to the typed error variants.

## UI presentation rules (yryvu)

| Severity | Surface | Examples |
|---|---|---|
| In-form / inline | `dialog__error` element under the offending field | InvalidBranchName, InvalidUrl, DestinationNotEmpty |
| Toast (loading) | `notify.loading()` open while clone runs | "Cloning to /path" |
| Toast (success) | `notify.success()` after success | "Cloned <name>", "Repository created at <path>" |
| Toast (info) | `notify.info()` for cancellations | "Clone cancelled" |
| Toast (error) | `notify.error()` for backend failures | CloneAuthFailed, CloneSslError, InitFailed |
| Modal post-success | `<Dialog>` with "Open now?" / "Stay" | After clone or init succeeds |

### Inline vs. toast partitioning

Rule: use **inline** errors when the user can fix the offending field
without leaving the dialog (validation). Use **toast** when the failure
came from the backend (auth, network, filesystem).

### yryvu deviation: surface auth-required as a clear actionable

When `CloneAuthRequired { host }` fires, toast text:

> Authentication required for <host>. Verify your git credential helper
> is set up (see `git config --global credential.helper`) or use SSH.

Don't pop a credentials prompt in v1. Tell the user where the issue is
and let them fix it via global git config. Filter follow-up to a future
issue: "in-app credentials prompt for HTTPS clone".

## Cross-validation

```
$ grep -n "Error-CreateLocalRepoFailed\|Error-CouldNotWriteToRepo\|LOCAL_PATH_AND_URL_REQUIRED" /tmp/gk-bundle-pretty.js
132619: throw new Error(at("Error-CouldNotWriteToRepo"))
202858: telemetry: { message: "Error-CreateLocalRepoFailed" }
$ grep -n "InitRepo-InvalidDefaultBranchName" /tmp/gk-bundle-pretty.js
53891: errorText: Dr ? "" : Ma("InitRepo-InvalidDefaultBranchName"),
82175: ... ct("InitRepo-InvalidDefaultBranchName")
```

Confirmed.
