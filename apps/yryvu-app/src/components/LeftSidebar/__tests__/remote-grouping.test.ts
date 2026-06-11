// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import type { BranchInfo } from "../../../ipc";
import { groupRemoteBranches } from "../helpers";

const remote = (name: string): BranchInfo => ({
  name,
  full_name: `refs/remotes/${name}`,
  kind: "remote",
  tip_sha: "0".repeat(40),
  is_head: false,
  upstream: null,
  ahead: 0,
  behind: 0,
});

const BRANCHES = [
  remote("origin/main"),
  remote("origin/develop"),
  remote("origin/feat/folder-rows"),
  remote("upstream/main"),
];

describe("groupRemoteBranches", () => {
  it("groups branches under their configured remote", () => {
    const groups = groupRemoteBranches(["origin", "upstream"], BRANCHES, "");
    expect(groups.map((g) => g.remote)).toEqual(["origin", "upstream"]);
    expect(groups[0].branches.map((b) => b.name)).toEqual([
      "origin/main",
      "origin/develop",
      "origin/feat/folder-rows",
    ]);
    expect(groups[1].branches.map((b) => b.name)).toEqual(["upstream/main"]);
  });

  it("keeps empty remotes visible when not filtering", () => {
    const groups = groupRemoteBranches(
      ["origin", "just-added"],
      BRANCHES,
      "",
    );
    expect(groups.map((g) => g.remote)).toEqual(["origin", "just-added"]);
    expect(groups[1].branches).toEqual([]);
  });

  it("hides empty remotes mid-filter (GK behaviour)", () => {
    const groups = groupRemoteBranches(
      ["origin", "just-added"],
      BRANCHES,
      "main",
    );
    expect(groups.map((g) => g.remote)).toEqual(["origin"]);
    expect(groups[0].branches.map((b) => b.name)).toEqual(["origin/main"]);
  });

  it("folder-name match keeps the folder with ALL its branches", () => {
    const groups = groupRemoteBranches(["origin", "upstream"], BRANCHES, "origi");
    expect(groups.map((g) => g.remote)).toEqual(["origin"]);
    expect(groups[0].branches).toHaveLength(3);
  });

  it("branch-name match keeps only matching branches per folder", () => {
    const groups = groupRemoteBranches(
      ["origin", "upstream"],
      BRANCHES,
      "develop",
    );
    expect(groups.map((g) => g.remote)).toEqual(["origin"]);
    expect(groups[0].branches.map((b) => b.name)).toEqual(["origin/develop"]);
  });

  it("filter is case-insensitive on both folder and branch labels", () => {
    expect(
      groupRemoteBranches(["origin"], BRANCHES, "ORIGIN")[0].branches,
    ).toHaveLength(3);
    expect(
      groupRemoteBranches(["origin"], BRANCHES, "DEVELOP")[0].branches,
    ).toHaveLength(1);
  });

  it("does not cross-match prefixes between remotes ('ori' vs 'origin')", () => {
    const branches = [remote("ori/x"), ...BRANCHES];
    const groups = groupRemoteBranches(["ori", "origin"], branches, "");
    expect(groups[0].branches.map((b) => b.name)).toEqual(["ori/x"]);
    expect(groups[1].branches).toHaveLength(3);
  });

  it("drops branches whose remote is not configured (transient orphans)", () => {
    const branches = [remote("gone/main"), ...BRANCHES];
    const groups = groupRemoteBranches(["origin"], branches, "");
    expect(groups).toHaveLength(1);
    expect(groups[0].branches.every((b) => b.name.startsWith("origin/"))).toBe(
      true,
    );
  });
});
