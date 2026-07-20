// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runUndo: vi.fn(),
  runRedo: vi.fn(),
  undoDirtyPrompt: vi.fn((): unknown => null),
  openCommandPalette: vi.fn(),
  toggleDetailPanelOpen: vi.fn(),
}));

vi.mock("../../undoOps", () => ({
  runUndo: mocks.runUndo,
  runRedo: mocks.runRedo,
  undoDirtyPrompt: mocks.undoDirtyPrompt,
}));

vi.mock("../CommandPalette/state", () => ({
  openCommandPalette: mocks.openCommandPalette,
}));

vi.mock("../../state/detail-panel-layout", () => ({
  toggleDetailPanelOpen: mocks.toggleDetailPanelOpen,
}));

vi.mock("../../tabs/keybinds", () => ({
  matchTabKeybind: () => null,
  runTabKeybind: vi.fn(),
}));

import { handleGlobalKeyDown } from "./globalKeydown";

// The suite runs on `environment: "node"` (see vitest.config.ts — adding
// jsdom for one dispatcher test is not worth a devDependency). The handler
// only ever reaches for `HTMLElement` through an `instanceof` on the event
// target, so a bare class satisfies it: nothing here is an instance of it.
(globalThis as { HTMLElement?: unknown }).HTMLElement = class {};

type FakeKeyEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "shiftKey" | "repeat" | "target"
> & { preventDefault: () => void };

function press(key: string, init: Partial<FakeKeyEvent> = {}): void {
  const e: FakeKeyEvent = {
    key,
    ctrlKey: true,
    metaKey: false,
    shiftKey: false,
    repeat: false,
    target: null,
    preventDefault: () => {},
    ...init,
  };
  handleGlobalKeyDown(e as unknown as KeyboardEvent);
}

afterEach(() => {
  vi.clearAllMocks();
  mocks.undoDirtyPrompt.mockReturnValue(null);
});

describe("globalKeydown modal guard (#473)", () => {
  it("runs undo/redo normally when no dialog is parked", () => {
    press("z");
    expect(mocks.runUndo).toHaveBeenCalledTimes(1);
    press("z", { shiftKey: true });
    expect(mocks.runRedo).toHaveBeenCalledTimes(1);
  });

  it("ignores undo/redo keybinds while the dirty dialog is open", () => {
    mocks.undoDirtyPrompt.mockReturnValue({ kind: "undo", label: "merge" });

    press("z");
    press("z", { shiftKey: true });
    press("y");

    // The parked prompt lives in a single signal — a second keypress would
    // overwrite it and the dialog would execute an op the user never read.
    expect(mocks.runUndo).not.toHaveBeenCalled();
    expect(mocks.runRedo).not.toHaveBeenCalled();
  });

  it("blocks the other shell keybinds too — the dialog is modal", () => {
    mocks.undoDirtyPrompt.mockReturnValue({ kind: "undo", label: "merge" });

    press("p");
    press("k");

    expect(mocks.openCommandPalette).not.toHaveBeenCalled();
    expect(mocks.toggleDetailPanelOpen).not.toHaveBeenCalled();
  });
});
