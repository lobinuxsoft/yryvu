// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/// Mirrors `crate::repo::undo::UndoOutcome` (kebab-case via serde tag).
export type UndoOutcome =
  | { outcome: "applied"; kind_label: string; discarded_dirty: boolean }
  | { outcome: "untrackable"; reason: string };

/// Mirrors `crate::commands::undo::UndoRedoState`. `null` is serde's
/// rendering of `Option<String>::None`.
export interface UndoRedoState {
  can_undo: boolean;
  undo_label: string | null;
  undo_count: number;
  /// The entry Undo would apply already cost uncommitted work; reversing
  /// it moves HEAD back but does not restore what was discarded.
  undo_lost_work: boolean;
  can_redo: boolean;
  redo_label: string | null;
  redo_count: number;
  /// Same, for the entry Redo would apply.
  redo_lost_work: boolean;
}

export function getUndoRedoState(repoPath: string): Promise<UndoRedoState> {
  return invoke<UndoRedoState>("get_undo_redo_state", { repoPath });
}

/// `force` confirms the user was asked about — and accepted — discarding
/// uncommitted work. Without it the backend refuses destructive undos on a
/// dirty tree.
export function undoLastOperation(
  repoPath: string,
  force = false,
): Promise<UndoOutcome> {
  return invoke<UndoOutcome>("undo_last_operation", { repoPath, force });
}

export function redoLastUndo(
  repoPath: string,
  force = false,
): Promise<UndoOutcome> {
  return invoke<UndoOutcome>("redo_last_undo", { repoPath, force });
}

/// The backend refused because the working tree is dirty (BackendError::
/// WorkingTreeDirty). Tauri flattens typed errors to their Display string,
/// so matching on the message is the only handle we have.
export function isWorkingTreeDirtyError(err: unknown): boolean {
  return String(err).includes("working tree has uncommitted changes");
}
