// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Provider table — yryvu's distillation of GK's `integrationInfo`
 * (`bundle:166355`–`166940`). Drops every GK-proprietary field
 * (`gkProjects`, `requiresProToAuthenticate`, `enabledInGitKrakenEnterprise`,
 * `launchpadTabLabelTranslation`, `refreshTokenRouteName`,
 * `authEndpointName`, plus the `google` / `sso` GK-account-only entries).
 *
 * Order matches `bundle:119112` (`orderedIntegrationSubTabTypes`) verbatim.
 *
 * **yryvu v1 auth deviation** (audit doc 02 "Auth modes — provider
 * reality vs GK enum"): GK's `USERNAME_AND_PASSWORD` mode is dropped
 * entirely — only Jira Server uses it in GK, and PAT is the
 * upstream-recommended replacement. Our `authType: "PAT"` for Jira
 * Server reflects that. SSH is git-transport-only (handled by
 * `build_credentials_callbacks`), not in this table.
 *
 * **yryvu v1 icon deviation**: yryvu ships SolidJS without Font
 * Awesome's brand icons. Until we add proper SVG brand paths in a
 * follow-up, providers use a colored initials badge — `colorAccent`
 * keys the badge background, `initials` the label inside.
 */

export type IntegrationType =
  | "github"
  | "githubEnterprise"
  | "gitlab"
  | "gitlabSelfHosted"
  | "gitea"
  | "giteaSelfHosted"
  | "bitbucket"
  | "bitbucketServer"
  | "azureDevops"
  | "jiraCloud"
  | "jiraServer"
  | "trello";

export type AuthType = "OAUTH" | "PAT";

export type IntegrationRole = "HOSTING_SERVICE" | "ISSUE_TRACKER";

export interface ProviderInfo {
  /** Stable identity key, used everywhere as `integrationType`. */
  type: IntegrationType;
  /** Short display name (e.g. `"GitHub"`). */
  label: string;
  /** Disambiguating display name (e.g. `"GitHub Enterprise Server"`). */
  verboseLabel: string;
  /** What the user sees as the "service host" (e.g. `"GitHub.com"`). */
  hostnameLabel: string;
  /** Literal hostname or `null` for self-hosted variants (custom URL). */
  hostname: string | null;
  /** Roles this provider fulfils. Drives the section it appears in. */
  roles: readonly IntegrationRole[];
  /** Primary auth mode yryvu uses. */
  authType: AuthType;
  /** Self-hosted = needs custom-hostname plumbing. */
  isSelfHosted: boolean;
  /** Two-or-three letter badge text (yryvu-only, see top-of-file note). */
  initials: string;
  /** Hex color for the badge background. */
  colorAccent: string;
  /**
   * Roadmap cohort:
   * - `"v1"` — ships first (OAuth + PAT fallback live).
   * - `"v2"` — self-hosted variants, custom-hostname plumbing first.
   * - `"skip"` — never planned (Trello, custom auth flow).
   */
  cohort: "v1" | "v2" | "skip";
  /** PR/MR character (`"#"` GitHub-style, `"!"` GitLab MRs). */
  prCharacter: "#" | "!" | null;
  /**
   * URL of the provider's "create a Personal Access Token" page,
   * deep-linked from the PAT entry dialog. For `.com` providers this is
   * an absolute URL; for self-hosted variants it's a relative path that
   * gets concatenated to the user-supplied hostname.
   *
   * **yryvu deviation**: GK leaves this `null` for `.com` providers
   * (`bundle:166381`+) — the user is expected to know the path. yryvu
   * fills these in with public, well-known URLs for a less friction-y
   * UX. Where GK has the path verbatim (self-hosted), yryvu mirrors it
   * 1:1.
   */
  tokenGenPath: string | null;
  /**
   * Querystring appended to `tokenGenPath` to pre-select the right
   * scopes. Verbatim from `bundle:166446` (GitHub Enterprise) where
   * applicable. `null` when the provider's PAT page doesn't accept
   * URL-driven scope selection (Atlassian, Bitbucket, Azure).
   */
  tokenGenParams: string | null;
  /**
   * Bitbucket calls Personal Access Tokens "App Passwords"
   * (`PATsAreCalledAppPasswords` flag, `bundle:166682`). Drives the
   * relabeling in the PAT entry dialog and the Connect form copy.
   */
  tokenIsAppPassword: boolean;
}

/**
 * The 10 providers, ordered by GK's `orderedIntegrationSubTabTypes`
 * (`bundle:119112`). Don't alphabetise — match GK's order verbatim
 * for muscle-memory parity.
 */
export const PROVIDERS: readonly ProviderInfo[] = [
  {
    type: "github",
    label: "GitHub",
    verboseLabel: "GitHub",
    hostnameLabel: "GitHub.com",
    hostname: "github.com",
    roles: ["HOSTING_SERVICE", "ISSUE_TRACKER"],
    authType: "OAUTH",
    isSelfHosted: false,
    initials: "GH",
    colorAccent: "#181717",
    cohort: "v1",
    prCharacter: "#",
    tokenGenPath: "https://github.com/settings/tokens/new",
    tokenGenParams: "scopes=repo,admin:org,admin:public_key,workflow&description=yryvu",
    tokenIsAppPassword: false,
  },
  {
    type: "githubEnterprise",
    label: "GitHub Enterprise Server",
    verboseLabel: "GitHub Enterprise Server",
    hostnameLabel: "GitHub Enterprise Server",
    hostname: null,
    roles: ["HOSTING_SERVICE", "ISSUE_TRACKER"],
    authType: "PAT",
    isSelfHosted: true,
    initials: "GHE",
    colorAccent: "#2b3137",
    cohort: "v2",
    prCharacter: "#",
    tokenGenPath: "/settings/tokens/new",
    tokenGenParams: "scopes=repo,admin:org,admin:public_key,workflow&description=yryvu",
    tokenIsAppPassword: false,
  },
  {
    type: "gitlab",
    label: "GitLab",
    verboseLabel: "GitLab",
    hostnameLabel: "GitLab.com",
    hostname: "gitlab.com",
    roles: ["HOSTING_SERVICE", "ISSUE_TRACKER"],
    authType: "OAUTH",
    isSelfHosted: false,
    initials: "GL",
    colorAccent: "#fc6d26",
    cohort: "v1",
    prCharacter: "!",
    tokenGenPath: "https://gitlab.com/-/user_settings/personal_access_tokens",
    tokenGenParams: null,
    tokenIsAppPassword: false,
  },
  {
    type: "gitlabSelfHosted",
    label: "GitLab (Self-Managed)",
    verboseLabel: "GitLab Self-Managed",
    hostnameLabel: "GitLab Self-Managed",
    hostname: null,
    roles: ["HOSTING_SERVICE", "ISSUE_TRACKER"],
    authType: "PAT",
    isSelfHosted: true,
    initials: "GLS",
    colorAccent: "#e24329",
    cohort: "v2",
    prCharacter: "!",
    tokenGenPath: "/-/user_settings/personal_access_tokens",
    tokenGenParams: null,
    tokenIsAppPassword: false,
  },
  {
    // Gitea is yryvu-only — GK doesn't ship a Gitea integration.
    // Default deployment is Codeberg.org (most-visible public Gitea
    // instance); self-hosted variant covers everything else.
    type: "gitea",
    label: "Gitea",
    verboseLabel: "Gitea / Codeberg",
    hostnameLabel: "Codeberg.org",
    hostname: "codeberg.org",
    roles: ["HOSTING_SERVICE", "ISSUE_TRACKER"],
    authType: "PAT",
    isSelfHosted: false,
    initials: "GT",
    colorAccent: "#609926",
    cohort: "v1",
    prCharacter: "#",
    tokenGenPath: "https://codeberg.org/user/settings/applications",
    tokenGenParams: null,
    tokenIsAppPassword: false,
  },
  {
    type: "giteaSelfHosted",
    label: "Gitea (Self-Hosted)",
    verboseLabel: "Gitea / Forgejo Self-Hosted",
    hostnameLabel: "Gitea / Forgejo Self-Hosted",
    hostname: null,
    roles: ["HOSTING_SERVICE", "ISSUE_TRACKER"],
    authType: "PAT",
    isSelfHosted: true,
    initials: "GTS",
    colorAccent: "#4d8a2a",
    cohort: "v2",
    prCharacter: "#",
    tokenGenPath: "/user/settings/applications",
    tokenGenParams: null,
    tokenIsAppPassword: false,
  },
  {
    type: "bitbucket",
    label: "Bitbucket",
    verboseLabel: "Bitbucket",
    hostnameLabel: "Bitbucket.org",
    hostname: "bitbucket.org",
    roles: ["HOSTING_SERVICE"],
    authType: "OAUTH",
    isSelfHosted: false,
    initials: "BB",
    colorAccent: "#0052cc",
    cohort: "v1",
    prCharacter: "#",
    tokenGenPath: "https://bitbucket.org/account/settings/app-passwords/new",
    tokenGenParams: null,
    tokenIsAppPassword: true,
  },
  {
    type: "bitbucketServer",
    label: "Bitbucket Data Center",
    verboseLabel: "Bitbucket Data Center",
    hostnameLabel: "Bitbucket Data Center",
    hostname: null,
    roles: ["HOSTING_SERVICE"],
    authType: "PAT",
    isSelfHosted: true,
    initials: "BBS",
    colorAccent: "#172b4d",
    cohort: "v2",
    prCharacter: "#",
    tokenGenPath: "/account",
    tokenGenParams: null,
    tokenIsAppPassword: true,
  },
  {
    type: "azureDevops",
    label: "Azure DevOps",
    verboseLabel: "Azure DevOps",
    hostnameLabel: "Azure DevOps",
    hostname: "dev.azure.com",
    roles: ["HOSTING_SERVICE"],
    authType: "PAT",
    isSelfHosted: false,
    initials: "AZ",
    colorAccent: "#0078d4",
    cohort: "v1",
    prCharacter: "#",
    tokenGenPath: "https://dev.azure.com/_usersSettings/tokens",
    tokenGenParams: null,
    tokenIsAppPassword: false,
  },
  {
    type: "jiraCloud",
    label: "Jira",
    verboseLabel: "Jira Cloud",
    hostnameLabel: "Jira Cloud",
    hostname: "atlassian.net",
    roles: ["ISSUE_TRACKER"],
    authType: "OAUTH",
    isSelfHosted: false,
    initials: "JC",
    colorAccent: "#0052cc",
    cohort: "v1",
    prCharacter: null,
    tokenGenPath: "https://id.atlassian.com/manage-profile/security/api-tokens",
    tokenGenParams: null,
    tokenIsAppPassword: false,
  },
  {
    type: "jiraServer",
    label: "Jira Data Center",
    verboseLabel: "Jira Data Center",
    hostnameLabel: "Jira Data Center",
    hostname: null,
    roles: ["ISSUE_TRACKER"],
    authType: "PAT",
    isSelfHosted: true,
    initials: "JS",
    colorAccent: "#172b4d",
    cohort: "v2",
    prCharacter: null,
    tokenGenPath: "/plugins/servlet/access-tokens/add",
    tokenGenParams: null,
    tokenIsAppPassword: false,
  },
  {
    type: "trello",
    label: "Trello",
    verboseLabel: "Trello",
    hostnameLabel: "Trello",
    hostname: "trello.com",
    roles: ["ISSUE_TRACKER"],
    authType: "PAT",
    isSelfHosted: false,
    initials: "T",
    colorAccent: "#0079bf",
    cohort: "skip",
    prCharacter: null,
    tokenGenPath: null,
    tokenGenParams: null,
    tokenIsAppPassword: false,
  },
];

export function findProvider(type: IntegrationType): ProviderInfo {
  const found = PROVIDERS.find((p) => p.type === type);
  if (!found) throw new Error(`Unknown integration type: ${type}`);
  return found;
}
