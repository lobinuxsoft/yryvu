// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it } from "vitest";

import {
  clearDiffNavigator,
  diffNavigator,
  fileViewMode,
  isDiffMode,
  lastDiffMode,
  setDiffNavigator,
  setDiffViewMode,
  setFileViewMode,
  setOuterView,
} from "../diff-view-mode";

describe("diff-view-mode state", () => {
  beforeEach(() => {
    localStorage.clear();
    setFileViewMode("hunk");
    clearDiffNavigator();
  });

  it("defaults to HUNK per GK init state", () => {
    expect(fileViewMode()).toBe("hunk");
    expect(isDiffMode()).toBe(true);
  });

  it("setDiffViewMode records the last diff mode", () => {
    setDiffViewMode("split");
    expect(fileViewMode()).toBe("split");
    expect(lastDiffMode()).toBe("split");
  });

  it("setOuterView('file') switches to CONTENT", () => {
    setOuterView("file");
    expect(fileViewMode()).toBe("content");
    expect(isDiffMode()).toBe(false);
  });

  it("setOuterView('diff') restores the last diff mode", () => {
    setDiffViewMode("inline");
    setOuterView("file");
    expect(fileViewMode()).toBe("content");
    setOuterView("diff");
    expect(fileViewMode()).toBe("inline");
  });

  it("diff navigator channel registers + clears", () => {
    expect(diffNavigator()).toBeNull();
    const nav = { next: () => {}, prev: () => {} };
    setDiffNavigator(nav);
    expect(diffNavigator()).toBe(nav);
    clearDiffNavigator();
    expect(diffNavigator()).toBeNull();
  });

  it("blame mode is an outer-toggle peer of file/diff", async () => {
    const { setOuterView, outerView } = await import("../diff-view-mode");
    setOuterView("blame");
    expect(fileViewMode()).toBe("blame");
    expect(outerView()).toBe("blame");
    expect(isDiffMode()).toBe(false);

    setOuterView("diff");
    expect(outerView()).toBe("diff");
    expect(isDiffMode()).toBe(true);
  });
});
