// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { DEFAULT_ZOOM, ZOOM_FACTORS } from "./zoom";

describe("zoom ladder", () => {
  it("matches GK Desktop 12.1.1 status-bar dropdown (10 values, 80–200%)", () => {
    expect(ZOOM_FACTORS).toEqual([
      0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2.0,
    ]);
  });

  it("default is 100%", () => {
    expect(DEFAULT_ZOOM).toBe(1.0);
  });

  it("default is in the ladder", () => {
    expect(ZOOM_FACTORS).toContain(DEFAULT_ZOOM);
  });

  it("ladder is monotonically increasing", () => {
    for (let i = 1; i < ZOOM_FACTORS.length; i++) {
      expect(ZOOM_FACTORS[i]).toBeGreaterThan(ZOOM_FACTORS[i - 1]!);
    }
  });
});
