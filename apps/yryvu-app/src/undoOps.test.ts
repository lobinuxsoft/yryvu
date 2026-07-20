// SPDX-License-Identifier: AGPL-3.0-or-later

import { afterEach, describe, expect, it, vi } from "vitest";

import type { UndoOutcome } from "./ipc";

const mocks = vi.hoisted(() => ({
  undoLastOperation: vi.fn(),
  redoLastUndo: vi.fn(),
  repoPath: vi.fn((): string | null => "/repo"),
  undoRedoState: vi.fn(() => ({
    can_undo: true,
    undo_label: "commit",
    undo_count: 1,
    undo_lost_work: false,
    can_redo: true,
    redo_label: "commit",
    redo_count: 1,
    redo_lost_work: false,
  })),
}));

vi.mock("./ipc", () => ({
  undoLastOperation: mocks.undoLastOperation,
  redoLastUndo: mocks.redoLastUndo,
  isWorkingTreeDirtyError: () => false,
}));

vi.mock("./components/Notifications", () => ({
  notify: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    loading: vi.fn(),
  },
}));

vi.mock("./state", () => ({
  refreshBranches: vi.fn(),
  refreshGraph: vi.fn(),
  refreshUndoRedo: vi.fn(),
  refreshWorkingTree: vi.fn(),
  repoPath: mocks.repoPath,
  undoRedoState: mocks.undoRedoState,
}));

// Imported after the mocks are declared so the module binds to them.
import { runRedo, runUndo } from "./undoOps";
import { notify } from "./components/Notifications";

const APPLIED: UndoOutcome = {
  outcome: "applied",
  kind_label: "commit",
  discarded_dirty: false,
};

/// A promise whose resolution we drive by hand, to hold an op "in flight".
function deferred(): { promise: Promise<UndoOutcome>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<UndoOutcome>((res) => {
    resolve = () => res(APPLIED);
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("undoOps in-flight guard (#472)", () => {
  it("drops a second undo while the first is still running", async () => {
    const d = deferred();
    mocks.undoLastOperation.mockReturnValueOnce(d.promise);

    const first = runUndo();
    const second = runUndo(); // must bail — first is in flight

    expect(mocks.undoLastOperation).toHaveBeenCalledTimes(1);

    d.resolve();
    await Promise.all([first, second]);

    // Once settled, a fresh undo runs again.
    mocks.undoLastOperation.mockResolvedValueOnce(APPLIED);
    await runUndo();
    expect(mocks.undoLastOperation).toHaveBeenCalledTimes(2);
  });

  it("shares the guard across undo and redo", async () => {
    const d = deferred();
    mocks.undoLastOperation.mockReturnValueOnce(d.promise);

    const undo = runUndo();
    const redo = runRedo(); // must bail — an undo is in flight

    expect(mocks.undoLastOperation).toHaveBeenCalledTimes(1);
    expect(mocks.redoLastUndo).not.toHaveBeenCalled();

    d.resolve();
    await Promise.all([undo, redo]);
  });
});

describe("discarded-work toast (#475)", () => {
  it("says the discarded changes are gone when force destroyed work", async () => {
    mocks.undoLastOperation.mockResolvedValueOnce({
      outcome: "applied",
      kind_label: "merge",
      discarded_dirty: true,
    } satisfies UndoOutcome);

    await runUndo();

    expect(notify.success).toHaveBeenCalledWith(
      "Undone",
      expect.objectContaining({
        message: expect.stringContaining("Redo does not recover them"),
      }),
    );
  });

  it("stays quiet when nothing was discarded", async () => {
    mocks.undoLastOperation.mockResolvedValueOnce(APPLIED);

    await runUndo();

    expect(notify.success).toHaveBeenCalledWith(
      "Undone",
      expect.objectContaining({ message: "commit" }),
    );
  });
});
