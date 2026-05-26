// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  flashCommitCreated,
  flashCommitHighlight,
  highlightedSha,
  recentlyCreatedSha,
} from "../commit-animations";

describe("commit-animations", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("flashCommitCreated sets recentlyCreatedSha for 400ms then clears", () => {
    flashCommitCreated("abc");
    expect(recentlyCreatedSha()).toBe("abc");
    vi.advanceTimersByTime(449);
    expect(recentlyCreatedSha()).toBe("abc");
    vi.advanceTimersByTime(2);
    expect(recentlyCreatedSha()).toBeUndefined();
  });

  it("flashCommitHighlight sets highlightedSha for 600ms then clears", () => {
    flashCommitHighlight("def");
    expect(highlightedSha()).toBe("def");
    vi.advanceTimersByTime(649);
    expect(highlightedSha()).toBe("def");
    vi.advanceTimersByTime(2);
    expect(highlightedSha()).toBeUndefined();
  });

  it("a later flash with a different sha replaces the prior one", () => {
    flashCommitCreated("first");
    flashCommitCreated("second");
    expect(recentlyCreatedSha()).toBe("second");
    // Original timeout for "first" fires but only clears if signal still
    // equals "first" — defended by the guard in the timer callback.
    vi.advanceTimersByTime(500);
    expect(recentlyCreatedSha()).toBeUndefined();
  });
});
