# Onboarding strings (verbatim, with bundle line)

All i18n keys touched by the onboarding cluster. Use these as the
authoritative source when chajá writes its own copy. chajá will use
plain English text directly (no i18n system in v1 for these surfaces),
but the keys document GK's intended copy structure.

The actual user-facing text is NOT in the bundle (translations live
elsewhere); only the keys are. Where the rendered text is constructed
from a template (e.g. `Notification-CloningToPath`), the placeholder
position is preserved with `{0}`.

## Form titles + descriptions

| Key | Bundle line | Suggested chajá copy |
|---|---|---|
| `OnboardingOpenRepoForm-title` | 96623 | "Open repository" |
| `OnboardingOpenRepoForm-desc` | 96625 | "Pick a folder containing a Git repository on your machine." |
| `OnboardingOpenRepoForm-LocalPath` | 96629 | "Local path" |
| `OnboardingOpenRepoForm-BrowseYourRepos` | 96637 | "Select a folder…" |
| `OnboardingOpenRepoForm-OpenTheRepo` | 96645 | "Open" |
| `OnboardingChooseRepoForm-title` | 294760 | (deferred — doc 01) |
| `OnboardingChooseRepoForm-desc` | 294762 | (deferred) |
| `OnboardingChooseRepoForm-watchVideo` | 294783 | (deferred) |
| `OnboardingChooseRepoForm-viewDocs` | 294790 | (deferred) |
| `OnboardingChooseRepoForm-repoName` | 231787 | (deferred) |
| `OnboardingChooseRepoForm-repoPath` | 231799 | (deferred) |
| `OnboardingCloneRepoForm-title` | 209655 | "Clone repository" |
| `OnboardingCloneRepoForm-CloneARepoWithUrl` | 209634 | "Clone a repository from a URL" |
| `OnboardingCloneRepoForm-CloneWith` | 209635 | "Clone with {0}" (URL) |
| `OnboardingCloneRepoForm-CloneFrom` | 209635 | (per-provider, SKIP v1) |
| `OnboardingCloneRepoForm-Url` | 209636 | "URL" |
| `OnboardingCloneRepoForm-IntegrationConnected` | 209634 | (per-provider, SKIP v1) |
| `OnboardingCloneRepoForm-CloneDestinationPath` | 147450 | "Destination" |
| `OnboardingCloneRepoForm-RepoToCloneUrl` | 303543 | "URL of repository to clone" |

## Clone form

| Key | Bundle line | Suggested chajá copy |
|---|---|---|
| `CloneRepo-CloneViaUrl` | 92333 | "URL" (tab label) |
| `CloneRepo-RepoToCloneUrl` | 100882, 303543 | "Repository URL" |
| `CloneRepo-CloneDestinationPath` | 147450, 211441, 286032, 355444 | "Destination path" |
| `CloneRepo-ClonedRepoName` | 260518, 286058, 295169, 355524 | "Folder name" |
| `CloneRepo-ShallowCloneToggle` | 59523, 79207 | "Shallow clone" |
| `CloneRepo-SparseCheckoutToggle` | 208947 | (SKIP v1) |
| `CloneRepo-ShallowOrSparseCloneOnlyAvailableInGitBinaryMode` | 79217, 295227 | (SKIP v1; chajá doesn't have this constraint) |
| `CloneRepo-CollapseSshSettings` | 209707, 368426 | (SKIP v1) |
| `CloneRepo-ExpandSshSettings` | 209708, 368426 | (SKIP v1) |
| `CloneRepo-CloneRepoButtonLabel` | 209717, 295236 | "Clone" |
| `CloneRepo-CloneSuccess` | 188514 | (SKIP — chajá auto-opens, no prompt) |
| `CloneRepo-CloneFailed` | 188708, 188734, 325719 | "Clone failed" |
| `CloneRepo-CloneRepository` | 285655, 381878, 381883 | "Clone repository" |
| `CloneRepo-CloneARepo` | 295252 | "Clone a repository" |
| `CloneRepo-RepoToCloneViaService` | 295160, 303551 | (SKIP v1) |
| `CloneRepo-Clone` | 355565 | "Clone" (button) |

## Init form (`InitRepo-` prefix)

| Key | Bundle line | Suggested chajá copy |
|---|---|---|
| `InitRepo-InitARepo` | 82647, 163493 | "Initialize repository" |
| `InitRepo-InitLocally` | 92345 | "Local" (tab label, but chajá has only this view so unused) |
| `InitRepo-CreateRepoTarget` | 63309, 82105, 286032 | "Path" |
| `InitRepo-DefaultBranchName` | 286081 | "Default branch" |
| `InitRepo-GitIgnoreTemplate` | 286136 | ".gitignore template" |
| `InitRepo-License` | 286144 | "License" |
| `InitRepo-CreateRepoButtonLabel` | 286160, 411758 | "Create" |
| `InitRepo-CreateRepoAndCloneButtonLabel` | 411758 | (SKIP — initFromHostingService only) |
| `InitRepo-InvalidDefaultBranchName` | 53891, 82175 | "Invalid branch name" |
| `InitRepo-PublicAccess` | 52102, 150909 | (SKIP — initFromHostingService only) |
| `InitRepo-PrivateAccess` | 150912 | (SKIP) |
| `InitRepo-PrivateRepoNeedsAnAccount` | 411805 | (SKIP) |
| `InitRepo-HostingServiceRepoNameLabel` | 286043, 411841 | (SKIP) |
| `InitRepo-HostingServiceProjectLabel` | 411764 | (SKIP) |
| `InitRepo-HostingServiceRepoDescriptionLabel` | 411779 | (SKIP) |
| `InitRepo-HostingServiceAccessLabel` | 411791 | (SKIP) |
| `InitRepo-HostingServiceAccountLabel` | 411828 | (SKIP) |
| `InitRepo-HostingServiceCloneAfterInitLabel` | 411851 | (SKIP) |

## Toast / notification keys

| Key | Bundle line | Suggested chajá copy |
|---|---|---|
| `Notification-CloningToPath` | 188557 | "Cloning to {0}" |
| `BrowseButtonLabel` | 286147 | "Browse…" |
| `OpenNowButtonLabel` | 188516 | "Open" |
| `OKButtonLabel` | 188517 | "OK" |

## Errors

| Key | Bundle line | Suggested chajá copy |
|---|---|---|
| `Error-CreateRemoteRepoFailed` (sic, used as title) | 202856 | "Failed to create repository" (chajá: use Local key) |
| `Error-CreateLocalRepoFailed` (telemetry) | 202858 | (telemetry only — same human title) |
| `Error-CouldNotWriteToRepo` | 132619 | "Could not write to repository" |
| `Error-CouldNotWriteReadmeAsRepoTabHasChanged` | 132576 | (chajá: not applicable — no tab swap during init) |
| `ErrorMessage-RemoteAccessDeniedButton` | 188724 | (SKIP — needs reconnect button) |
| `ErrorMessage-UnrecognizedAllowedTypes` | 150234 | (SKIP — internal libgit2 detail) |

## Misc

| Key | Bundle line | Notes |
|---|---|---|
| `LOCAL_PATH_AND_URL_REQUIRED` | 188497 | Internal error string, not user-facing |
| `LOCAL_PATH_REQUIRED` | 202836 | Internal error string |
| `RepoPathSelector-ScanningForRepositories` | 294776 | (deferred — doc 01) |
| `RepoManagement-searchRepositories` | 294772 | (chajá's RepoManagement filter does this) |
| `Workspace-CloneAllButtonLabel` | 285655 | (SKIP — Workspaces) |
| `Workspace-CloneXReposButtonLabel` | 285655 | (SKIP — Workspaces) |

## chajá-only strings (no GK equivalent)

These are string additions chajá needs that GK does not have:

| chajá key (proposed) | Suggested copy | Reason |
|---|---|---|
| `Onboarding-CancelClone` | "Cancel" | chajá adds clone-cancel button (GK has none) |
| `Onboarding-RepoCloned` | "Cloned {name}" | post-clone success toast (GK uses prompt instead) |
| `Onboarding-RepoCreated` | "Repository created at {path}" | post-init success toast |
| `Onboarding-InitializeFirstCommit` | "Initialize with first commit" | chajá-only checkbox |
| `Onboarding-CloneCancelled` | "Clone cancelled" | post-cancel info toast |
| `Onboarding-AuthRequired` | "Authentication required for {host}. Verify your git credential helper or use SSH." | chajá v1 deferred-prompt path |

These six strings cover the chajá-side UX additions documented across
docs 04, 05, 06, and 09.
