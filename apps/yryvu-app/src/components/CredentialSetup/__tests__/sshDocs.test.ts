// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import {
  defaultSshHost,
  ghInstallCommand,
  sshDocsUrl,
  sshSettingsUrl,
} from "../sshDocs";
import { hasUsableCredentials, type AuthEnv } from "../../../ipc/auth";

describe("ghInstallCommand", () => {
  it("returns a package-manager command for macOS and Windows", () => {
    expect(ghInstallCommand("macos")).toBe("brew install gh");
    expect(ghInstallCommand("windows")).toBe(
      "winget install --id GitHub.cli",
    );
  });

  it("returns null for Linux (distros vary — wizard shows docs instead)", () => {
    expect(ghInstallCommand("linux")).toBeNull();
    expect(ghInstallCommand("unknown")).toBeNull();
  });
});

describe("sshDocsUrl", () => {
  it("maps each provider to its own SSH guide", () => {
    expect(sshDocsUrl("gitlab")).toContain("gitlab.com");
    expect(sshDocsUrl("bitbucket")).toContain("atlassian.com");
    expect(sshDocsUrl("gitea")).toContain("gitea.com");
  });

  it("falls back to GitHub for github and unknown", () => {
    expect(sshDocsUrl("github")).toContain("github.com");
    expect(sshDocsUrl("unknown")).toContain("github.com");
  });
});

describe("sshSettingsUrl", () => {
  it("maps each provider to its key-settings page", () => {
    expect(sshSettingsUrl("github")).toBe("https://github.com/settings/keys");
    expect(sshSettingsUrl("gitlab")).toBe(
      "https://gitlab.com/-/user_settings/ssh_keys",
    );
    expect(sshSettingsUrl("bitbucket")).toBe(
      "https://bitbucket.org/account/settings/ssh-keys/",
    );
    expect(sshSettingsUrl("unknown")).toContain("github.com");
  });

  it("threads the self-hosted host into gitlab and gitea routes", () => {
    expect(sshSettingsUrl("gitlab", "git.corp.dev")).toBe(
      "https://git.corp.dev/-/user_settings/ssh_keys",
    );
    expect(sshSettingsUrl("gitea", "codeberg.org")).toBe(
      "https://codeberg.org/user/settings/keys",
    );
  });
});

describe("defaultSshHost", () => {
  it("prefills the SaaS host per provider, empty for self-hosted gitea", () => {
    expect(defaultSshHost("github")).toBe("github.com");
    expect(defaultSshHost("gitlab")).toBe("gitlab.com");
    expect(defaultSshHost("bitbucket")).toBe("bitbucket.org");
    expect(defaultSshHost("gitea")).toBe("");
    expect(defaultSshHost("unknown")).toBe("github.com");
  });
});

describe("hasUsableCredentials", () => {
  const base: AuthEnv = {
    sshAgentSocket: true,
    sshKeysLoaded: 0,
    credentialHelper: null,
    hostOs: "linux",
  };

  it("is false for a reachable-but-empty agent with no helper", () => {
    expect(hasUsableCredentials(base)).toBe(false);
  });

  it("is true with a loaded key", () => {
    expect(hasUsableCredentials({ ...base, sshKeysLoaded: 1 })).toBe(true);
  });

  it("is true with a credential helper", () => {
    expect(hasUsableCredentials({ ...base, credentialHelper: "store" })).toBe(
      true,
    );
  });
});
