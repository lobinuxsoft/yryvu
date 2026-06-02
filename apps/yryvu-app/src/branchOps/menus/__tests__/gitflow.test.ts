// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import type { BranchInfo, GitflowConfig } from "../../../ipc";
import {
  buildGithubFlowMenuItems,
  buildGitflowMenuItems,
  resolveGithubFlowBase,
  stripPrefix,
} from "../gitflow";
import type { MenuDeps } from "../types";

const DEFAULTS: GitflowConfig = {
  masterBranch: "main",
  developBranch: "develop",
  featurePrefix: "feature/",
  releasePrefix: "release/",
  hotfixPrefix: "hotfix/",
  bugfixPrefix: "bugfix/",
  supportPrefix: "support/",
  versionTagPrefix: "v",
};

function local(name: string): BranchInfo {
  return {
    name,
    full_name: `refs/heads/${name}`,
    kind: "local",
    tip_sha: "0".repeat(40),
    is_head: false,
    upstream: null,
    ahead: 0,
    behind: 0,
  } as BranchInfo;
}

/// Minimal MenuDeps with just the getters the gitflow builders read.
function deps(branches: BranchInfo[], cfg: GitflowConfig | null): MenuDeps {
  return {
    branchSource: () => branches,
    gitflowConfigSource: () => cfg,
    openGitflowStartDialog: () => {},
    openGitflowFinishDialog: () => {},
  } as unknown as MenuDeps;
}

const labels = (items: ReturnType<typeof buildGitflowMenuItems>) =>
  items.filter((i) => i.type !== "separator").map((i) => (i as { label: string }).label);

describe("buildGitflowMenuItems", () => {
  it("returns empty when gitflow is not initialised", () => {
    expect(buildGitflowMenuItems(deps([], null))).toEqual([]);
  });

  it("always offers the three Start entries", () => {
    const items = buildGitflowMenuItems(deps([], DEFAULTS));
    expect(labels(items)).toEqual(
      expect.arrayContaining(["Start feature…", "Start release…", "Start hotfix…"]),
    );
  });

  it("disables a Finish entry when no branch matches its prefix", () => {
    const items = buildGitflowMenuItems(
      deps([local("feature/login"), local("main")], DEFAULTS),
    );
    const feature = items.find(
      (i) => i.type !== "separator" && (i as { label: string }).label === "Finish feature…",
    ) as { disabled?: boolean };
    const release = items.find(
      (i) => i.type !== "separator" && (i as { label: string }).label === "Finish release…",
    ) as { disabled?: boolean };
    expect(feature.disabled).toBeFalsy();
    expect(release.disabled).toBe(true);
  });
});

describe("buildGithubFlowMenuItems", () => {
  it("excludes the base branch from finish candidates", () => {
    const items = buildGithubFlowMenuItems(
      deps([local("main"), local("topic")], DEFAULTS),
      "main",
    );
    const finish = items.find(
      (i) => (i as { label: string }).label === "Finish branch (GitHub Flow)…",
    ) as { disabled?: boolean };
    expect(finish.disabled).toBeFalsy();
  });

  it("disables finish when only the base branch exists", () => {
    const items = buildGithubFlowMenuItems(deps([local("main")], DEFAULTS), "main");
    const finish = items.find(
      (i) => (i as { label: string }).label === "Finish branch (GitHub Flow)…",
    ) as { disabled?: boolean };
    expect(finish.disabled).toBe(true);
  });
});

describe("resolveGithubFlowBase", () => {
  it("prefers the gitflow production branch when present", () => {
    expect(resolveGithubFlowBase(DEFAULTS, ["main", "develop"])).toBe("main");
  });

  it("falls back to main / master when no config", () => {
    expect(resolveGithubFlowBase(null, ["master", "x"])).toBe("master");
  });

  it("falls back to the first local branch otherwise", () => {
    expect(resolveGithubFlowBase(null, ["trunk"])).toBe("trunk");
  });
});

describe("stripPrefix", () => {
  it("strips the gitflow prefix to the bare name", () => {
    expect(stripPrefix("feature/login")).toBe("login");
    expect(stripPrefix("release/1.2.0")).toBe("1.2.0");
  });

  it("returns the name unchanged when there is no slash", () => {
    expect(stripPrefix("hotfix-1")).toBe("hotfix-1");
  });
});
