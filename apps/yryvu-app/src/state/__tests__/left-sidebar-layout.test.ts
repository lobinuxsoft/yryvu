// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { clampWidth, MIN_WIDTH } from "../left-sidebar-layout";

describe("left-sidebar clampWidth", () => {
  const MAX = 1200;

  it("returns MIN when input below floor", () => {
    expect(clampWidth(20, MAX)).toBe(MIN_WIDTH);
    expect(clampWidth(0, MAX)).toBe(MIN_WIDTH);
    expect(clampWidth(-50, MAX)).toBe(MIN_WIDTH);
  });

  it("returns MIN when input is NaN", () => {
    expect(clampWidth(Number.NaN, MAX)).toBe(MIN_WIDTH);
  });

  it("clamps to maxWidth when above ceiling", () => {
    expect(clampWidth(2000, MAX)).toBe(MAX);
  });

  it("passes through valid values", () => {
    expect(clampWidth(215, MAX)).toBe(215);
    expect(clampWidth(400, MAX)).toBe(400);
  });

  it("honors MIN_WIDTH even when maxWidth drops below it", () => {
    expect(clampWidth(300, 20)).toBe(MIN_WIDTH);
  });
});

describe("left-sidebar constants", () => {
  it("MIN matches the collapsed rail width (44px)", () => {
    expect(MIN_WIDTH).toBe(44);
  });
});
