// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it } from "vitest";

import {
  closeFileHistory,
  mainView,
  openFileHistory,
  selectedHistoryFile,
} from "../diff";

describe("file history state", () => {
  beforeEach(() => {
    closeFileHistory();
  });

  it("openFileHistory switches mainView + records the path", () => {
    openFileHistory("src/foo.ts");
    expect(mainView()).toBe("fileHistory");
    expect(selectedHistoryFile()).toBe("src/foo.ts");
  });

  it("closeFileHistory clears path and returns to graph", () => {
    openFileHistory("src/bar.ts");
    closeFileHistory();
    expect(mainView()).toBe("graph");
    expect(selectedHistoryFile()).toBeUndefined();
  });
});
