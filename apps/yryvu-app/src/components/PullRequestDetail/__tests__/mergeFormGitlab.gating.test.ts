// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import {
  defaultMethod,
  mergeMethodHint,
  methodAllowed,
  squashState,
} from "../mergeFormGitlab.gating";

describe("methodAllowed", () => {
  it("permits the merge-commit radio only when project policy is `merge`", () => {
    expect(methodAllowed("merge", "merge")).toBe(true);
    expect(methodAllowed("rebaseMerge", "merge")).toBe(false);
    expect(methodAllowed("ff", "merge")).toBe(false);
  });

  it("always permits squash + rebase regardless of project policy", () => {
    for (const policy of ["merge", "rebaseMerge", "ff"] as const) {
      expect(methodAllowed(policy, "squash")).toBe(true);
      expect(methodAllowed(policy, "rebase")).toBe(true);
    }
  });
});

describe("mergeMethodHint", () => {
  it("returns a per-policy hint string", () => {
    expect(mergeMethodHint("merge")).toMatch(/merge commits/i);
    expect(mergeMethodHint("rebaseMerge")).toMatch(/rebase before merge/i);
    expect(mergeMethodHint("ff")).toMatch(/fast-forward only/i);
  });
});

describe("squashState", () => {
  it("hides the checkbox when squashing is forbidden", () => {
    expect(squashState("never")).toEqual({
      visible: false,
      locked: true,
      defaultChecked: false,
    });
  });

  it("locks the checkbox checked when squashing is mandatory", () => {
    expect(squashState("always")).toEqual({
      visible: true,
      locked: true,
      defaultChecked: true,
    });
  });

  it("leaves the checkbox toggleable for `defaultOff`", () => {
    expect(squashState("defaultOff")).toEqual({
      visible: true,
      locked: false,
      defaultChecked: false,
    });
  });

  it("leaves the checkbox toggleable for `defaultOn`", () => {
    expect(squashState("defaultOn")).toEqual({
      visible: true,
      locked: false,
      defaultChecked: true,
    });
  });
});

describe("defaultMethod", () => {
  it("picks merge when allowed", () => {
    expect(defaultMethod("merge")).toBe("merge");
  });

  it("falls back to rebase when merge is forbidden", () => {
    expect(defaultMethod("rebaseMerge")).toBe("rebase");
    expect(defaultMethod("ff")).toBe("rebase");
  });
});
