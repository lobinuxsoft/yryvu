// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import {
  clampCommitRegionHeight,
  COMMIT_OPTIONS_EXTRA_HEIGHT,
  MIN_COMMIT_REGION_HEIGHT,
} from "../detail-panel-layout";

const MIN = MIN_COMMIT_REGION_HEIGHT;

describe("commit region clamp (issue #151 item D)", () => {
  it("passes a height that fits through untouched", () => {
    expect(clampCommitRegionHeight(400, 900)).toBe(400);
  });

  it("floors at the minimum", () => {
    expect(clampCommitRegionHeight(10, 900)).toBe(MIN);
  });

  it("caps at the space left above it", () => {
    expect(clampCommitRegionHeight(800, 500)).toBe(500);
  });

  it("keeps the floor when the window can't even honour it", () => {
    // A commit button clipped off the bottom is worse than a scrollbar:
    // the floor outranks the ceiling, and the form's own scroller
    // absorbs the overflow.
    expect(clampCommitRegionHeight(400, 100)).toBe(MIN);
  });

  it("raises the floor while Commit options is expanded", () => {
    const expanded = MIN + COMMIT_OPTIONS_EXTRA_HEIGHT;
    expect(clampCommitRegionHeight(MIN, 900, expanded)).toBe(expanded);
  });

  it("treats a non-finite height as the floor", () => {
    // A drag started before the panel is measured must not resolve to NaN
    // and write NaN into preferences.
    expect(clampCommitRegionHeight(Number.NaN, 900)).toBe(MIN);
  });

  it("an unmeasured ceiling does not shrink the region", () => {
    // `useCommitRegionHeight` passes Infinity until the ResizeObserver
    // fires — an unmeasured panel is not a short one (the lesson #37
    // paid for with the graph column widths).
    expect(clampCommitRegionHeight(600, Infinity)).toBe(600);
  });
});
