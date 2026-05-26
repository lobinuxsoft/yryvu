// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import {
  clampHeight,
  clampWidth,
  MIN_HEIGHT,
  MIN_WIDTH,
} from "../detail-panel-layout";

describe("clampWidth", () => {
  const MAX = 1600;

  it("returns MIN when input below floor", () => {
    expect(clampWidth(100, MAX)).toBe(MIN_WIDTH);
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
    expect(clampWidth(400, MAX)).toBe(400);
    expect(clampWidth(800, MAX)).toBe(800);
  });

  it("honors MIN_WIDTH even when maxWidth drops below it", () => {
    // Viewport shrunk to a tiny pane — never go below the floor.
    expect(clampWidth(500, 100)).toBe(MIN_WIDTH);
  });
});

describe("clampHeight", () => {
  const MAX = 1080;

  it("returns MIN when input below floor", () => {
    expect(clampHeight(200, MAX)).toBe(MIN_HEIGHT);
    expect(clampHeight(0, MAX)).toBe(MIN_HEIGHT);
  });

  it("returns MIN when input is NaN", () => {
    expect(clampHeight(Number.NaN, MAX)).toBe(MIN_HEIGHT);
  });

  it("clamps to maxHeight when above ceiling", () => {
    expect(clampHeight(2000, MAX)).toBe(MAX);
  });

  it("passes through valid values", () => {
    expect(clampHeight(700, MAX)).toBe(700);
  });

  it("honors MIN_HEIGHT even when maxHeight drops below it", () => {
    expect(clampHeight(800, 200)).toBe(MIN_HEIGHT);
  });
});

describe("constants", () => {
  it("match GK audit doc 01 verbatim", () => {
    expect(MIN_WIDTH).toBe(353);
    expect(MIN_HEIGHT).toBe(566);
  });
});
