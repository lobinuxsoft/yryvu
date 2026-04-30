// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { computeTargetIndex } from "../dragMath";

/// Build a row of equal-width contiguous rects starting at x=0.
function rects(count: number, width = 100, startX = 0) {
  return Array.from({ length: count }, (_, i) => {
    const left = startX + i * width;
    return { left, right: left + width, width };
  });
}

describe("computeTargetIndex", () => {
  it("clamps to original index when no pills exist", () => {
    expect(computeTargetIndex(0, [], 0)).toBe(0);
    expect(computeTargetIndex(0, [], 5)).toBe(5);
  });

  it("returns 0 when cursor is left of the first pill midpoint", () => {
    const r = rects(3); // [0..100, 100..200, 200..300]
    expect(computeTargetIndex(0, r, 1)).toBe(0);
    expect(computeTargetIndex(49, r, 1)).toBe(0);
  });

  it("crossing the first midpoint lands target on index 1", () => {
    const r = rects(3);
    expect(computeTargetIndex(50, r, 0)).toBe(1);
    expect(computeTargetIndex(149, r, 0)).toBe(1);
  });

  it("clamps to last index past the right edge", () => {
    const r = rects(3);
    expect(computeTargetIndex(999, r, 0)).toBe(2);
    expect(computeTargetIndex(280, r, 0)).toBe(2);
  });

  it("midpoint exactly is < (strict) so falls through to next slot", () => {
    const r = rects(3); // mid of slot 0 is x=50
    expect(computeTargetIndex(50, r, 0)).toBe(1); // 50 is NOT < 50, so falls through
  });

  it("works with non-uniform widths", () => {
    // Pill 0: 0..40 (mid 20), pill 1: 40..160 (mid 100), pill 2: 160..200 (mid 180)
    const r = [
      { left: 0, right: 40, width: 40 },
      { left: 40, right: 160, width: 120 },
      { left: 160, right: 200, width: 40 },
    ];
    expect(computeTargetIndex(15, r, 2)).toBe(0);
    expect(computeTargetIndex(80, r, 2)).toBe(1);
    expect(computeTargetIndex(170, r, 0)).toBe(2);
  });
});
