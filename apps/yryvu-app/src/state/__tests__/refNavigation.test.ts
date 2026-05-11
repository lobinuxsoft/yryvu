// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it } from "vitest";

import {
  clearPendingRefNav,
  navigateToRef,
  pendingRefNav,
} from "../refNavigation";

describe("refNavigation (issue #72)", () => {
  beforeEach(() => {
    clearPendingRefNav();
  });

  it("starts with no pending request", () => {
    expect(pendingRefNav()).toBeUndefined();
  });

  it("navigateToRef sets a pending request with the sha", () => {
    navigateToRef("abc123");
    const req = pendingRefNav();
    expect(req).toBeDefined();
    expect(req?.sha).toBe("abc123");
  });

  it("clearPendingRefNav resets to undefined", () => {
    navigateToRef("abc123");
    clearPendingRefNav();
    expect(pendingRefNav()).toBeUndefined();
  });

  it("two navigateToRef calls with the same sha bump seq so the effect re-fires", () => {
    navigateToRef("abc123");
    const first = pendingRefNav();
    expect(first).toBeDefined();
    const firstSeq = first!.seq;

    clearPendingRefNav();

    navigateToRef("abc123");
    const second = pendingRefNav();
    expect(second).toBeDefined();
    expect(second!.sha).toBe("abc123");
    expect(second!.seq).toBeGreaterThan(firstSeq);
  });

  it("seq increases monotonically across calls", () => {
    navigateToRef("a");
    const seqA = pendingRefNav()!.seq;
    navigateToRef("b");
    const seqB = pendingRefNav()!.seq;
    navigateToRef("c");
    const seqC = pendingRefNav()!.seq;
    expect(seqB).toBeGreaterThan(seqA);
    expect(seqC).toBeGreaterThan(seqB);
  });

  it("empty sha is a no-op", () => {
    navigateToRef("");
    expect(pendingRefNav()).toBeUndefined();
  });

  it("navigateToRef replaces a prior pending request with the latest sha", () => {
    navigateToRef("a");
    navigateToRef("b");
    expect(pendingRefNav()?.sha).toBe("b");
  });
});
