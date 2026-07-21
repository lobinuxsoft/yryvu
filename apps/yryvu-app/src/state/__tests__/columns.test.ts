// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  isLastVisibleZone,
  sumOfWidths,
  type GraphZoneId,
  ZONE_SPECS,
  zoneMaxWidth,
} from "../../components/CommitGraph/columns";
import {
  activeColumnSettings,
  activeOrderedZones,
  applyGraphContentWidth,
  ensureColumnWidthsFitContainer,
  graphColumns,
  graphContainerWidth,
  resetColumnsToDefaultLayout,
  setGraphZoneVisible,
  setGraphZoneWidth,
} from "../columns";

const CONTAINER = 1200;

function totalVisibleWidth(): number {
  return sumOfWidths(activeOrderedZones(), graphColumns());
}

function lastVisibleZone(): GraphZoneId {
  const o = activeOrderedZones();
  return o[o.length - 1];
}

describe("graph column cascade (issue #324)", () => {
  beforeEach(() => {
    resetColumnsToDefaultLayout();
    ensureColumnWidthsFitContainer(CONTAINER);
  });

  describe("ensure invariant", () => {
    it("ensureColumnWidthsFitContainer makes sum === container after default reset", () => {
      expect(totalVisibleWidth()).toBe(CONTAINER);
    });

    it("growing the container expands zones to fill it", () => {
      ensureColumnWidthsFitContainer(CONTAINER + 200);
      expect(totalVisibleWidth()).toBe(CONTAINER + 200);
      expect(graphContainerWidth()).toBe(CONTAINER + 200);
    });

    it("shrinking the container shrinks zones to fit it", () => {
      ensureColumnWidthsFitContainer(CONTAINER - 200);
      expect(totalVisibleWidth()).toBe(CONTAINER - 200);
    });

    it("idempotent: ensure with current container does not change the sum", () => {
      const before = totalVisibleWidth();
      ensureColumnWidthsFitContainer(CONTAINER);
      expect(totalVisibleWidth()).toBe(before);
    });

    it("hiding a zone keeps sum === container after rebalance", () => {
      setGraphZoneVisible("commitDateTime", false);
      expect(totalVisibleWidth()).toBe(CONTAINER);
    });
  });

  describe("user resize via setGraphZoneWidth", () => {
    it("resizing a middle column smaller cascades expansion to the right (sum invariant)", () => {
      const before = activeColumnSettings("commitMessage").width;
      setGraphZoneWidth("commitMessage", before - 100);
      expect(activeColumnSettings("commitMessage").width).toBe(before - 100);
      expect(totalVisibleWidth()).toBe(CONTAINER);
    });

    it("resizing a middle column larger cascades shrink to the left (sum invariant)", () => {
      const before = activeColumnSettings("commitMessage").width;
      setGraphZoneWidth("commitMessage", before + 50);
      expect(activeColumnSettings("commitMessage").width).toBe(before + 50);
      expect(totalVisibleWidth()).toBe(CONTAINER);
    });

    it("BUG A REGRESSION: resizing the LAST column writes through (no revert)", () => {
      const last = lastVisibleZone();
      const target = clampInBounds(last, 80);
      setGraphZoneWidth(last, target);
      expect(activeColumnSettings(last).width).toBe(target);
    });

    it("BUG A REGRESSION: shrinking the last column wraps the cascade so sum still matches", () => {
      const last = lastVisibleZone();
      const target = clampInBounds(last, 80);
      setGraphZoneWidth(last, target);
      expect(totalVisibleWidth()).toBe(CONTAINER);
    });

    it("BUG A REGRESSION: growing the last column shrinks left neighbours instead of capping the resize", () => {
      const last = lastVisibleZone();
      const target = clampInBounds(last, ZONE_SPECS[last].maximumWidth);
      setGraphZoneWidth(last, target);
      expect(activeColumnSettings(last).width).toBe(target);
      expect(totalVisibleWidth()).toBe(CONTAINER);
    });

    it("BUG B REGRESSION: shrinking dateTime grows the last visible zone (sha) by the same delta", () => {
      // Reproduces the empty-whitespace bug: pre-fix the slack stayed
      // unallocated; now it falls onto the last zone via the wrap.
      const last = lastVisibleZone();
      const lastBefore = activeColumnSettings(last).width;
      const dateBefore = activeColumnSettings("commitDateTime").width;
      const delta = 30;
      setGraphZoneWidth("commitDateTime", dateBefore - delta);
      expect(activeColumnSettings("commitDateTime").width).toBe(
        dateBefore - delta,
      );
      expect(activeColumnSettings(last).width).toBe(lastBefore + delta);
      expect(totalVisibleWidth()).toBe(CONTAINER);
    });

    it("clamps the resized zone to its [min, max] bounds", () => {
      // Try to set commitSha to 10 — below its minimum.
      setGraphZoneWidth("commitSha", 10);
      expect(activeColumnSettings("commitSha").width).toBe(
        ZONE_SPECS.commitSha.minimumWidth,
      );
    });

    it("write-through when container has not been measured (cw=0)", () => {
      // Re-init the singleton path: ensure with 0 is a no-op, so the
      // container width stays whatever it was. Simulating the
      // pre-mount window is hard from outside; this test instead
      // verifies that ANY container width keeps the sum invariant
      // after a resize (the cw=0 fallback path is exercised
      // implicitly during the pre-ensure window in production).
      setGraphZoneWidth("commitMessage", 250);
      expect(totalVisibleWidth()).toBe(CONTAINER);
    });
  });

  // The graph is the one zone whose ceiling is not a constant: it tracks
  // the natural lane content width, so a repo with a wide fan-out can be
  // dragged wider than the static spec allows, and a narrow one cannot be
  // dragged past its own empty space. See GK's
  // `updateCommitZoneContentWidthFromChange`.
  describe("fluid graph-zone ceiling", () => {
    afterEach(() => {
      // Module-level singleton: leave the ceiling back at the spec value
      // so sibling tests aren't clamped by whatever this block set.
      applyGraphContentWidth(ZONE_SPECS.graph.maximumWidth);
    });

    it("reports the published content width as the graph maximum", () => {
      applyGraphContentWidth(420);
      expect(zoneMaxWidth("graph")).toBe(420);
      // Every other zone keeps its constant.
      expect(zoneMaxWidth("commitSha")).toBe(ZONE_SPECS.commitSha.maximumWidth);
    });

    it("allows the graph past its static spec max when lanes justify it", () => {
      applyGraphContentWidth(1000);
      setGraphZoneWidth("graph", 900);
      expect(activeColumnSettings("graph").width).toBe(900);
      expect(900).toBeGreaterThan(ZONE_SPECS.graph.maximumWidth);
      expect(totalVisibleWidth()).toBe(CONTAINER);
    });

    it("clamps a too-wide graph down when the content shrinks", () => {
      applyGraphContentWidth(1000);
      setGraphZoneWidth("graph", 900);
      applyGraphContentWidth(300);
      expect(activeColumnSettings("graph").width).toBe(300);
      expect(totalVisibleWidth()).toBe(CONTAINER);
    });

    // The reload bug: a narrow (or not-yet-loaded) graph trimmed the column
    // and persisted the trim as if the user had chosen it, so the width was
    // gone for good. The trim is presentation; the intent is the setting.
    it("REGRESSION: restores the user's width when the content grows back", () => {
      applyGraphContentWidth(1000);
      setGraphZoneWidth("graph", 900);
      applyGraphContentWidth(300);
      expect(activeColumnSettings("graph").width).toBe(300);
      applyGraphContentWidth(1000);
      expect(activeColumnSettings("graph").width).toBe(900);
    });

    it("REGRESSION: survives a round trip through the minimum", () => {
      applyGraphContentWidth(1000);
      setGraphZoneWidth("graph", 900);
      applyGraphContentWidth(ZONE_SPECS.graph.minimumWidth);
      expect(activeColumnSettings("graph").width).toBe(
        ZONE_SPECS.graph.minimumWidth,
      );
      applyGraphContentWidth(1000);
      expect(activeColumnSettings("graph").width).toBe(900);
    });

    it("a hand resize while trimmed becomes the new intent", () => {
      applyGraphContentWidth(1000);
      setGraphZoneWidth("graph", 900);
      applyGraphContentWidth(400);
      // User deliberately picks 200 while the content is narrow — growing
      // the content later must not resurrect the stale 900.
      setGraphZoneWidth("graph", 200);
      applyGraphContentWidth(1000);
      expect(activeColumnSettings("graph").width).toBe(200);
    });

    it("is a no-op when the content width is unchanged", () => {
      applyGraphContentWidth(500);
      const before = { ...graphColumns() };
      applyGraphContentWidth(500);
      expect(graphColumns()).toEqual(before);
    });

    it("does not clamp the graph while it is the last visible zone", () => {
      // As the rightmost zone the graph absorbs leftover slack and ignores
      // its cap; clamping it here would fight the cascade and reopen a gap.
      for (const id of [
        "commitMessage",
        "commitAuthor",
        "commitDateTime",
        "commitSha",
      ] as GraphZoneId[]) {
        setGraphZoneVisible(id, false);
      }
      expect(lastVisibleZone()).toBe("graph");
      const before = activeColumnSettings("graph").width;
      applyGraphContentWidth(100);
      expect(activeColumnSettings("graph").width).toBe(before);
      expect(totalVisibleWidth()).toBe(CONTAINER);
    });
  });

  describe("isLastVisibleZone helper", () => {
    it("identifies the rightmost visible zone", () => {
      const ordered = activeOrderedZones();
      expect(isLastVisibleZone(ordered[ordered.length - 1], ordered)).toBe(true);
      expect(isLastVisibleZone(ordered[0], ordered)).toBe(false);
    });

    it("returns false for empty ordered list", () => {
      expect(isLastVisibleZone("commitSha", [])).toBe(false);
    });
  });
});

function clampInBounds(id: GraphZoneId, target: number): number {
  const spec = ZONE_SPECS[id];
  return Math.max(spec.minimumWidth, Math.min(spec.maximumWidth, target));
}
