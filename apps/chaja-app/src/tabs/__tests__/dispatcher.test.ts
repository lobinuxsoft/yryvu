// SPDX-License-Identifier: AGPL-3.0-or-later

import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the IPC layer so persistTabs is a no-op during tests. Without this,
// every dispatcher op would attempt a real Tauri invoke and crash under
// vitest (no Tauri runtime in the test process).
vi.mock("../../ipc/preferences", () => ({
  getPreferences: vi.fn(),
  setPreferences: vi.fn(),
  resetPreferences: vi.fn(),
}));

import { performTabOperation } from "../dispatcher";
import {
  _resetForTests,
  closedTabs,
  currentTab,
  permanentTabs,
  selectedTabId,
  tabs,
} from "../state";
import { type Tab } from "../types";

beforeEach(() => {
  _resetForTests();
});

function repoTab(id: string, repoPath: string, isWorktree = false): Tab {
  return { type: "REPO", id, repoPath, isWorktree };
}

describe("dispatcher — CREATE / SWITCH_TO basics", () => {
  it("CREATE appends + auto-switches when switchToCreatedTab", async () => {
    await performTabOperation({
      type: "CREATE",
      switchToCreatedTab: true,
      tabParams: repoTab("a", "/p"),
    });
    expect(tabs()).toHaveLength(1);
    expect(selectedTabId()).toBe("a");
  });

  it("CREATE without switch leaves selection untouched", async () => {
    await performTabOperation({
      type: "CREATE",
      switchToCreatedTab: true,
      tabParams: repoTab("a", "/p"),
    });
    await performTabOperation({
      type: "CREATE",
      switchToCreatedTab: false,
      tabParams: repoTab("b", "/q"),
    });
    expect(tabs()).toHaveLength(2);
    expect(selectedTabId()).toBe("a");
  });

  it("SWITCH_TO no-ops on unknown tabId", async () => {
    await performTabOperation({
      type: "CREATE",
      switchToCreatedTab: true,
      tabParams: repoTab("a", "/p"),
    });
    await performTabOperation({ type: "SWITCH_TO", tabId: "ghost" });
    expect(selectedTabId()).toBe("a");
  });
});

describe("dispatcher — MUTATE preserves tabId (bundle:2588 contract)", () => {
  it("MUTATE keeps the original id even if tabParams.id differs", async () => {
    await performTabOperation({
      type: "CREATE",
      switchToCreatedTab: true,
      tabParams: { type: "NEW", id: "nt-1" },
    });
    await performTabOperation({
      type: "MUTATE",
      tabId: "nt-1",
      // Caller passes a different id — dispatcher must override with original
      tabParams: { type: "REPO", id: "wrong", repoPath: "/p", isWorktree: false },
    });
    const cur = currentTab();
    expect(cur).toBeDefined();
    expect(cur!.id).toBe("nt-1"); // preserved, NOT 'wrong'
    expect(cur!.type).toBe("REPO");
    expect((cur as { repoPath: string }).repoPath).toBe("/p");
  });

  it("MUTATE preserves the array index", async () => {
    await performTabOperation({
      type: "CREATE",
      switchToCreatedTab: true,
      tabParams: repoTab("a", "/a"),
    });
    await performTabOperation({
      type: "CREATE",
      switchToCreatedTab: false,
      tabParams: { type: "NEW", id: "b" },
    });
    await performTabOperation({
      type: "CREATE",
      switchToCreatedTab: false,
      tabParams: repoTab("c", "/c"),
    });
    await performTabOperation({
      type: "MUTATE",
      tabId: "b",
      tabParams: repoTab("b", "/mutated"),
    });
    const list = tabs();
    expect(list).toHaveLength(3);
    expect(list[1].id).toBe("b");
    expect(list[1].type).toBe("REPO");
    expect((list[1] as { repoPath: string }).repoPath).toBe("/mutated");
  });
});

describe("dispatcher — CLOSE adds to closedTabs (skip NEW type)", () => {
  it("CLOSE on REPO pushes to closedTabs with originalIndex", async () => {
    await performTabOperation({
      type: "CREATE",
      switchToCreatedTab: false,
      tabParams: repoTab("a", "/a"),
    });
    await performTabOperation({
      type: "CREATE",
      switchToCreatedTab: false,
      tabParams: repoTab("b", "/b"),
    });
    await performTabOperation({ type: "CLOSE", tabId: "b" });
    expect(tabs()).toHaveLength(1);
    const stack = closedTabs();
    expect(stack).toHaveLength(1);
    expect(stack[0].tab.id).toBe("b");
    expect(stack[0].originalIndex).toBe(1);
  });

  it("CLOSE on NEW does NOT push to closedTabs", async () => {
    await performTabOperation({
      type: "CREATE",
      switchToCreatedTab: true,
      tabParams: { type: "NEW", id: "nt" },
    });
    await performTabOperation({ type: "CLOSE", tabId: "nt" });
    expect(tabs()).toHaveLength(0);
    expect(closedTabs()).toHaveLength(0);
  });

  it("CLOSE on selected tab picks a fallback selection", async () => {
    await performTabOperation({
      type: "CREATE",
      switchToCreatedTab: false,
      tabParams: repoTab("a", "/a"),
    });
    await performTabOperation({
      type: "CREATE",
      switchToCreatedTab: true,
      tabParams: repoTab("b", "/b"),
    });
    await performTabOperation({
      type: "CREATE",
      switchToCreatedTab: false,
      tabParams: repoTab("c", "/c"),
    });
    await performTabOperation({ type: "CLOSE", tabId: "b" });
    // Fallback prefers the previous tab (now at idx 0).
    expect(selectedTabId()).toBe("a");
  });
});

describe("dispatcher — REOPEN restores to originalIndex", () => {
  it("REOPEN_LAST_CLOSED re-inserts at the closed position, not the end", async () => {
    await performTabOperation({
      type: "CREATE",
      switchToCreatedTab: false,
      tabParams: repoTab("a", "/a"),
    });
    await performTabOperation({
      type: "CREATE",
      switchToCreatedTab: false,
      tabParams: repoTab("b", "/b"),
    });
    await performTabOperation({
      type: "CREATE",
      switchToCreatedTab: false,
      tabParams: repoTab("c", "/c"),
    });
    // Close the leftmost — originalIndex=0
    await performTabOperation({ type: "CLOSE", tabId: "a" });
    expect(tabs().map((t) => t.id)).toEqual(["b", "c"]);
    // Reopen — must land at index 0, not the end
    await performTabOperation({ type: "REOPEN_LAST_CLOSED" });
    expect(tabs().map((t) => t.id)).toEqual(["a", "b", "c"]);
    expect(selectedTabId()).toBe("a");
  });
});

describe("dispatcher — SWITCH_TO REPO_MANAGEMENT auto-uncloses", () => {
  it("selecting the permanent tab id flips closed=false", async () => {
    // Seed permanent tab as closed via LOAD_TABS
    await performTabOperation({
      type: "LOAD_TABS",
      tabs: [],
      selectedTabId: undefined,
      permanentTabs: { repoManagement: { closed: true } },
    });
    expect(permanentTabs().repoManagement?.closed).toBe(true);
    await performTabOperation({ type: "SWITCH_TO", tabId: "REPO_MANAGEMENT" });
    expect(permanentTabs().repoManagement?.closed).toBe(false);
    expect(selectedTabId()).toBe("REPO_MANAGEMENT");
  });
});

describe("dispatcher — queue serialization", () => {
  it("concurrent ops apply in submission order (FIFO)", async () => {
    // Fire 5 CREATEs without awaiting — they must land in order
    const order = ["a", "b", "c", "d", "e"];
    const promises = order.map((id) =>
      performTabOperation({
        type: "CREATE",
        switchToCreatedTab: false,
        tabParams: repoTab(id, `/${id}`),
      }),
    );
    await Promise.all(promises);
    expect(tabs().map((t) => t.id)).toEqual(order);
  });

  it("an op rejection does not kill the queue", async () => {
    // First CREATE succeeds
    await performTabOperation({
      type: "CREATE",
      switchToCreatedTab: true,
      tabParams: repoTab("a", "/a"),
    });
    // SWITCH_TO unknown id is a silent no-op (not a rejection in our
    // current impl) — but verify a follow-up still applies cleanly.
    await performTabOperation({ type: "SWITCH_TO", tabId: "ghost" });
    await performTabOperation({
      type: "CREATE",
      switchToCreatedTab: true,
      tabParams: repoTab("b", "/b"),
    });
    expect(tabs().map((t) => t.id)).toEqual(["a", "b"]);
    expect(selectedTabId()).toBe("b");
  });
});

describe("dispatcher — MOVE", () => {
  it("MOVE swaps array positions non-destructively", async () => {
    for (const id of ["a", "b", "c"]) {
      await performTabOperation({
        type: "CREATE",
        switchToCreatedTab: false,
        tabParams: repoTab(id, `/${id}`),
      });
    }
    await performTabOperation({ type: "MOVE", oldIndex: 0, newIndex: 2 });
    expect(tabs().map((t) => t.id)).toEqual(["b", "c", "a"]);
  });

  it("MOVE clamped: out-of-range indices no-op", async () => {
    await performTabOperation({
      type: "CREATE",
      switchToCreatedTab: false,
      tabParams: repoTab("a", "/a"),
    });
    await performTabOperation({ type: "MOVE", oldIndex: 0, newIndex: 99 });
    expect(tabs().map((t) => t.id)).toEqual(["a"]);
  });
});
