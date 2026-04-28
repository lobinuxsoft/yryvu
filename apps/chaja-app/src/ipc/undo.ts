// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/// Mirrors `crate::repo::undo::UndoOutcome` (kebab-case via serde tag).
export type UndoOutcome =
  | { outcome: "applied"; kind_label: string }
  | { outcome: "untrackable"; reason: string };

/// Mirrors `crate::commands::undo::UndoRedoState`. `null` is serde's
/// rendering of `Option<String>::None`.
export interface UndoRedoState {
  can_undo: boolean;
  undo_label: string | null;
  can_redo: boolean;
  redo_label: string | null;
}

export function getUndoRedoState(repoPath: string): Promise<UndoRedoState> {
  return invoke<UndoRedoState>("get_undo_redo_state", { repoPath });
}

export function undoLastOperation(repoPath: string): Promise<UndoOutcome> {
  return invoke<UndoOutcome>("undo_last_operation", { repoPath });
}
