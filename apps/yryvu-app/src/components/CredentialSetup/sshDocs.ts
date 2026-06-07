// SPDX-License-Identifier: AGPL-3.0-or-later

import type { HostingService } from "../../ipc";

/** Provider-specific "generate an SSH key and add it to your account"
 * docs. Used by the wizard's "Configure SSH" path as a graceful
 * fallback until the in-app SSH key generation flow (#47) lands. */
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
