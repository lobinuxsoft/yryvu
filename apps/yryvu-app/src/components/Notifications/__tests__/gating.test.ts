// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationsPreferences, Preferences } from "../../../ipc";

// Mock the preferences module BEFORE importing the store so the store
// picks up the mocked `preferences` accessor instead of the real
// Solid resource (which would try to hit Tauri's IPC).
const mockPreferencesRef: { value: Preferences | undefined } = { value: undefined };
vi.mock("../../../state/preferences", () => ({
  preferences: () => mockPreferencesRef.value,
}));

// Imported after the mock so the store binds to the stub.
let storeMod: typeof import("../store");

function defaultNotificationsPrefs(): NotificationsPreferences {
  return {
    remoteSyncNotifications: true,
    branchNotifications: true,
    commitNotifications: true,
    stashNotifications: true,
    repoObjectNotifications: true,
    undoRedoNotifications: true,
  };
}

function makePrefs(overrides: Partial<NotificationsPreferences> = {}): Preferences {
  return {
    version: 1,
    general: {} as Preferences["general"],
    ui: {} as Preferences["ui"],
    tabs: {} as Preferences["tabs"],
    commit: {} as Preferences["commit"],
    tools: {} as Preferences["tools"],
    editor: {} as Preferences["editor"],
    notifications: { ...defaultNotificationsPrefs(), ...overrides },
    issueTracker: {} as Preferences["issueTracker"],
    gpg: {} as Preferences["gpg"],
    ssh: { keyPaths: {} },
    layout: {} as Preferences["layout"],
  };
}

beforeEach(async () => {
  vi.resetModules();
  mockPreferencesRef.value = undefined;
  // Re-import after each reset so the store binds against the fresh
  // mock state. `notify` from index.tsx wraps the store's `notify`
  // function — going through the store directly keeps the test
  // narrowly scoped to the gating behavior.
  storeMod = await import("../store");
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("notify gating against NotificationsPreferences", () => {
  it("emits when preferences are not loaded yet", () => {
    // First load races against `notify.*` calls fired from `createResource`
    // initialization. Until the resource resolves, the toaster passes
    // everything through — otherwise a user would lose toasts during
    // app boot.
    mockPreferencesRef.value = undefined;
    const id = storeMod.notify("success", "Pulled", { category: "remoteSync" });
    expect(id).not.toBe("");
    expect(storeMod.activeToasts()).toHaveLength(1);
  });

  it("emits when no category is set, regardless of preferences", () => {
    mockPreferencesRef.value = makePrefs({ remoteSyncNotifications: false });
    const id = storeMod.notify("success", "Repository cloned");
    expect(id).not.toBe("");
    expect(storeMod.activeToasts()).toHaveLength(1);
  });

  it("drops the toast when the category is muted", () => {
    mockPreferencesRef.value = makePrefs({ stashNotifications: false });
    const id = storeMod.notify("success", "Stash applied", {
      category: "stash",
    });
    expect(id).toBe("");
    expect(storeMod.activeToasts()).toHaveLength(0);
    expect(storeMod.history()).toHaveLength(0);
  });

  it("emits when the category is enabled", () => {
    mockPreferencesRef.value = makePrefs({ stashNotifications: true });
    const id = storeMod.notify("success", "Stash applied", {
      category: "stash",
    });
    expect(id).not.toBe("");
    expect(storeMod.activeToasts()).toHaveLength(1);
  });

  it("gates error toasts the same way as success", () => {
    // The user explicitly mutes a noisy category; that mute covers
    // both `success` and `error`. Severity-level granularity is a
    // follow-up if this proves too coarse.
    mockPreferencesRef.value = makePrefs({ commitNotifications: false });
    const id = storeMod.notify("error", "Commit failed", {
      category: "commit",
    });
    expect(id).toBe("");
    expect(storeMod.activeToasts()).toHaveLength(0);
  });

  it("bypasses gating for loading severity even when category is muted", () => {
    // Loading toasts carry progress signal the user explicitly asked
    // for — the user clicked Push, they want to see the spinner. The
    // success/error that follows still respects the category toggle.
    mockPreferencesRef.value = makePrefs({ remoteSyncNotifications: false });
    const id = storeMod.notify("loading", "Push…", {
      category: "remoteSync",
    });
    expect(id).not.toBe("");
    expect(storeMod.activeToasts()).toHaveLength(1);
  });

  it("emits when notifications object is missing on prefs (defensive)", () => {
    // Should never happen in practice — the backend always supplies
    // every section — but guard against partial preferences shapes
    // accidentally muting everything by being falsy.
    mockPreferencesRef.value = {
      version: 1,
      general: {} as Preferences["general"],
      ui: {} as Preferences["ui"],
      tabs: {} as Preferences["tabs"],
      commit: {} as Preferences["commit"],
      tools: {} as Preferences["tools"],
      editor: {} as Preferences["editor"],
      notifications: {} as NotificationsPreferences,
      issueTracker: {} as Preferences["issueTracker"],
      gpg: {} as Preferences["gpg"],
      ssh: { keyPaths: {} },
      layout: {} as Preferences["layout"],
    };
    const id = storeMod.notify("success", "Pulled", { category: "remoteSync" });
    expect(id).not.toBe("");
  });

  it("stores category on the active item for downstream filtering", () => {
    mockPreferencesRef.value = makePrefs();
    storeMod.notify("success", "Pulled", { category: "remoteSync" });
    const [item] = storeMod.activeToasts();
    expect(item?.category).toBe("remoteSync");
  });
});
