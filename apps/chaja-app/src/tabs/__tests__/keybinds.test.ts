// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { matchTabKeybind } from "../keybinds";

function key(
  k: string,
  opts: { meta?: boolean; ctrl?: boolean; shift?: boolean } = {},
) {
  return {
    key: k,
    metaKey: opts.meta ?? false,
    ctrlKey: opts.ctrl ?? false,
    shiftKey: opts.shift ?? false,
  };
}

describe("matchTabKeybind — modifier required", () => {
  it("returns null without Ctrl or Cmd", () => {
    expect(matchTabKeybind(key("t"))).toBeNull();
    expect(matchTabKeybind(key("w"))).toBeNull();
    expect(matchTabKeybind(key("Tab"))).toBeNull();
    expect(matchTabKeybind(key("1"))).toBeNull();
  });
});

describe("matchTabKeybind — 6 default mappings", () => {
  it("Ctrl+T → openNewTab", () => {
    expect(matchTabKeybind(key("t", { ctrl: true }))).toEqual({
      op: "openNewTab",
    });
  });

  it("Cmd+T → openNewTab (macOS)", () => {
    expect(matchTabKeybind(key("t", { meta: true }))).toEqual({
      op: "openNewTab",
    });
  });

  it("Ctrl+W → closeSelectedTab", () => {
    expect(matchTabKeybind(key("w", { ctrl: true }))).toEqual({
      op: "closeSelectedTab",
    });
  });

  it("Ctrl+Tab → selectNextTab", () => {
    expect(matchTabKeybind(key("Tab", { ctrl: true }))).toEqual({
      op: "selectNextTab",
    });
  });

  it("Ctrl+Shift+Tab → selectPreviousTab", () => {
    expect(matchTabKeybind(key("Tab", { ctrl: true, shift: true }))).toEqual({
      op: "selectPreviousTab",
    });
  });

  it("Ctrl+Shift+T → reopenMostRecentlyClosedTab (uppercase T)", () => {
    expect(matchTabKeybind(key("T", { ctrl: true, shift: true }))).toEqual({
      op: "reopenMostRecentlyClosedTab",
    });
  });

  it("Ctrl+Shift+t → reopenMostRecentlyClosedTab (lowercase fallback)", () => {
    // Some IMEs / non-US layouts emit lowercase even with shift held.
    expect(matchTabKeybind(key("t", { ctrl: true, shift: true }))).toEqual({
      op: "reopenMostRecentlyClosedTab",
    });
  });
});

describe("matchTabKeybind — Ctrl+1..9 → selectTabIndex(N-1)", () => {
  for (let n = 1; n <= 9; n += 1) {
    it(`Ctrl+${n} → selectTabIndex(${n - 1})`, () => {
      expect(matchTabKeybind(key(String(n), { ctrl: true }))).toEqual({
        op: "selectTabIndex",
        index: n - 1,
      });
    });
  }

  it("Ctrl+0 → null (not in 1-9 range)", () => {
    expect(matchTabKeybind(key("0", { ctrl: true }))).toBeNull();
  });
});

describe("matchTabKeybind — unrelated keys", () => {
  it("Ctrl+A returns null", () => {
    expect(matchTabKeybind(key("a", { ctrl: true }))).toBeNull();
  });

  it("Ctrl+Z returns null (handled by AppShell undo handler upstream)", () => {
    expect(matchTabKeybind(key("z", { ctrl: true }))).toBeNull();
  });

  it("Ctrl+Y returns null (handled by AppShell redo handler upstream)", () => {
    expect(matchTabKeybind(key("y", { ctrl: true }))).toBeNull();
  });

  it("Ctrl+Enter returns null", () => {
    expect(matchTabKeybind(key("Enter", { ctrl: true }))).toBeNull();
  });
});

describe("matchTabKeybind — both modifiers don't double-fire", () => {
  it("Cmd+Ctrl+T still matches openNewTab once (mod = either)", () => {
    expect(matchTabKeybind(key("t", { ctrl: true, meta: true }))).toEqual({
      op: "openNewTab",
    });
  });
});
