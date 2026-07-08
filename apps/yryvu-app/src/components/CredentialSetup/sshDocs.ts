// SPDX-License-Identifier: AGPL-3.0-or-later

import type { HostingService } from "../../ipc";

/** Provider-specific "generate an SSH key and add it to your account"
 * docs. Secondary link inside the SSH key generation dialog (#47). */
export function sshDocsUrl(provider: HostingService): string {
  switch (provider) {
    case "gitlab":
      return "https://docs.gitlab.com/ee/user/ssh.html";
    case "bitbucket":
      return "https://support.atlassian.com/bitbucket-cloud/docs/set-up-an-ssh-key/";
    case "gitea":
      return "https://docs.gitea.com/usage/authentication#ssh";
    default:
      return "https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent";
  }
}

/** Provider settings page where the generated public key gets pasted
 * (#47). `host` covers self-hosted GitLab / Gitea / Forgejo — when it
 * differs from the SaaS host the path convention still applies.
 * GitLab's canonical route changed in 16.6; self-hosted instances older
 * than that redirect from the legacy `/-/profile/keys`. */
export function sshSettingsUrl(provider: HostingService, host?: string): string {
  switch (provider) {
    case "gitlab":
      return `https://${host ?? "gitlab.com"}/-/user_settings/ssh_keys`;
    case "bitbucket":
      return "https://bitbucket.org/account/settings/ssh-keys/";
    case "gitea":
      return `https://${host ?? "gitea.com"}/user/settings/keys`;
    default:
      return "https://github.com/settings/keys";
  }
}

/** Default `git@<host>` SSH host per provider — prefills the dialog's
 * host field; self-hosted users overwrite it. */
export function defaultSshHost(provider: HostingService): string {
  switch (provider) {
    case "gitlab":
      return "gitlab.com";
    case "bitbucket":
      return "bitbucket.org";
    case "gitea":
      return "";
    default:
      return "github.com";
  }
}

/** Shell command to install the GitHub CLI for `os`
 * (`std::env::consts::OS`). `null` where there is no single canonical
 * command (Linux distros vary) — the wizard shows the docs link instead. */
export function ghInstallCommand(os: string): string | null {
  switch (os) {
    case "macos":
      return "brew install gh";
    case "windows":
      return "winget install --id GitHub.cli";
    default:
      return null;
  }
}
