// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import type { RefTag } from "../../ipc";
import {
  resolveDropActions,
  type DragPayload,
  type DragTarget,
} from "../dnd";

function ref(name: string, kind: RefTag["kind"] = "Branch"): RefTag {
  return {
    name,
    kind,
    upstream: null,
    ahead: 0,
    behind: 0,
  } as RefTag;
}

function refPayload(name: string, kind?: RefTag["kind"]): DragPayload {
  return { kind: "ref", tag: ref(name, kind), sha: "aaaa" };
}

function refTarget(name: string, kind?: RefTag["kind"]): DragTarget {
  return { kind: "ref", tag: ref(name, kind), sha: "bbbb" };
}

describe("resolveDropActions — ref onto ref", () => {
  it("returns empty when source and target are the same ref", () => {
    expect(resolveDropActions(refPayload("main"), refTarget("main"))).toEqual([]);
  });

  it("returns merge + rebase + fast-forward when target is HEAD", () => {
    const actions = resolveDropActions(refPayload("feat-x"), refTarget("HEAD", "Head"));
    const ids = actions.map((a) => a.id);
    expect(ids).toEqual(["merge", "rebase-current-onto", "fast-forward"]);
  });

  it("returns merge + rebase when target is non-HEAD branch", () => {
    const actions = resolveDropActions(refPayload("feat-x"), refTarget("main"));
    expect(actions.map((a) => a.id)).toEqual(["merge", "rebase-current-onto"]);
  });
});

describe("resolveDropActions — ref onto commit", () => {
  it("offers rebase-onto-sha + checkout-and-reset", () => {
    const target: DragTarget = { kind: "commit", sha: "abc1234".padEnd(40, "0") };
    const actions = resolveDropActions(refPayload("feat-x"), target);
    expect(actions.map((a) => a.id)).toEqual([
      "rebase-current-onto",
      "checkout",
    ]);
  });
});

describe("resolveDropActions — commit onto commit", () => {
  it("offers cherry-pick + 3 reset variants with hard danger-tinted", () => {
    const target: DragTarget = { kind: "commit", sha: "feed".padEnd(40, "0") };
    const source: DragPayload = { kind: "commit", sha: "abc1".padEnd(40, "0") };
    const actions = resolveDropActions(source, target);
    expect(actions.map((a) => a.id)).toEqual([
      "cherry-pick",
      "reset-soft",
      "reset-mixed",
      "reset-hard",
    ]);
    expect(actions[3].danger).toBe(true);
  });
});

describe("resolveDropActions — commit onto ref", () => {
  it("offers cherry-pick onto current when target is HEAD", () => {
    const source: DragPayload = { kind: "commit", sha: "abc1".padEnd(40, "0") };
    const actions = resolveDropActions(source, refTarget("HEAD", "Head"));
    expect(actions.map((a) => a.id)).toEqual(["cherry-pick"]);
    expect(actions[0].label).toContain("onto current");
  });

  it("offers cherry-pick onto that branch when target is a regular ref", () => {
    const source: DragPayload = { kind: "commit", sha: "abc1".padEnd(40, "0") };
    const actions = resolveDropActions(source, refTarget("release-2"));
    expect(actions.map((a) => a.id)).toEqual(["cherry-pick-onto-ref"]);
    expect(actions[0].label).toContain("'release-2'");
  });
});
