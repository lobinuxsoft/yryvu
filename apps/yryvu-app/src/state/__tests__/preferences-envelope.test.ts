// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Preferences } from "../../ipc/preferences";

/// Stand-in for the file on disk. `setPreferences` overwrites it whole,
/// exactly like the backend command — which is the reason a private
/// in-memory copy per writer was destructive.
// Seeded at declaration, not in `beforeEach`: the module under test
// kicks off its load during import, which happens before any hook runs.
let onDisk: Preferences = seed();

function seed(): Preferences {
  return {
    layout: {
      detailPanel: { width: 400, height: 386, open: true },
      leftSidebar: { width: 215, open: true },
      commitRegion: { height: 300 },
    },
  } as unknown as Preferences;
}

vi.mock("../../ipc", () => ({
  getPreferences: vi.fn(async () => onDisk),
  setPreferences: vi.fn(async (next: Preferences) => {
    onDisk = structuredClone(next);
    return onDisk;
  }),
  resetPreferences: vi.fn(async () => {
    onDisk = seed();
    return onDisk;
  }),
}));

const { mutatePreferences, preferencesReady } = await import("../preferences");

const widenSidebar = (width: number) => (p: Preferences) => ({
  ...p,
  layout: { ...p.layout, leftSidebar: { ...p.layout.leftSidebar, width } },
});

const widenInspector = (width: number) => (p: Preferences) => ({
  ...p,
  layout: { ...p.layout, detailPanel: { ...p.layout.detailPanel, width } },
});

beforeEach(() => {
  onDisk = seed();
});

describe("preferences envelope is written from one copy", () => {
  it("sequential writers from different modules both survive", async () => {
    await mutatePreferences(widenSidebar(320));
    await mutatePreferences(widenInspector(700));

    expect(onDisk.layout.leftSidebar.width).toBe(320);
    expect(onDisk.layout.detailPanel.width).toBe(700);
  });

  it("concurrent writers compose instead of overwriting each other", async () => {
    // The original bug: two modules each cached the envelope at boot and
    // wrote it back whole, so whichever saved second reverted the other's
    // field to its boot value. Firing both without awaiting reproduces it.
    await Promise.all([
      mutatePreferences(widenSidebar(320)),
      mutatePreferences(widenInspector(700)),
    ]);

    expect(onDisk.layout.leftSidebar.width).toBe(320);
    expect(onDisk.layout.detailPanel.width).toBe(700);
  });

  it("a mutator reads the envelope as of its turn, not as of its call", async () => {
    const seen: number[] = [];
    await Promise.all([
      mutatePreferences(widenSidebar(320)),
      mutatePreferences((p) => {
        seen.push(p.layout.leftSidebar.width);
        return p;
      }),
    ]);

    expect(seen).toEqual([320]);
  });

  it("a failed write does not wedge the queue behind it", async () => {
    const boom = mutatePreferences(() => {
      throw new Error("backend exploded");
    });
    await expect(boom).rejects.toThrow("backend exploded");

    await mutatePreferences(widenSidebar(320));
    expect(onDisk.layout.leftSidebar.width).toBe(320);
  });

  it("preferencesReady resolves without a second backend round-trip", async () => {
    const { getPreferences } = await import("../../ipc");
    await preferencesReady();
    await preferencesReady();
    expect(vi.mocked(getPreferences).mock.calls.length).toBeLessThanOrEqual(1);
  });
});
