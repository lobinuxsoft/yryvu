// SPDX-License-Identifier: AGPL-3.0-or-later

import { repoPath, setRepoPathRaw } from "./repo-base";
import { reloadCommitFilterForRepo } from "./commit-filter";
import { clearSelection } from "./selection";
import { setSelectedDiffFile } from "./diff";
import { setHoveredRef, setInspectorMode, setPinnedSha } from "./inspector";
import {
  setAmendEnabled,
  setCommitDescription,
  setCommitMessage,
} from "./commit-draft";
import { mutateUndoRedoState, mutateWorkingTreeStatus } from "./refresh";

/// Swap the active repository. Clears every per-repo ephemeral signal
/// (selection, hovered ref, inspector mode, draft commit message,
/// amend, …) so stale state from the previous repo doesn't leak — the
/// classic repro was clicking commits after a switch and nothing
/// responding because `selectedCommit` still pointed at a SHA that
/// didn't exist in the new repo, which in turn pinned the WIP
/// calculations and inspector resources on ghost data.
///
/// Lives in its own module so the cleanup wiring (which fans out to
/// every per-repo slice) doesn't drag selection / diff / inspector
/// implementations into one file.
export function setRepoPath(next: string | undefined): void {
  const prev = repoPath();
  setRepoPathRaw(next);
  if (prev === next) return;
  clearSelection();
  setSelectedDiffFile(undefined);
  setHoveredRef(undefined);
  setPinnedSha(undefined);
  setInspectorMode("details");
  setCommitMessage("");
  setCommitDescription("");
  setAmendEnabled(false);
  // Invalidate the WIP resource so the previous repo's working-tree
  // status doesn't leak across the switch (the WIP cell + right-panel
  // staging UI used to show the old repo's dirty files until the new
  // fetch resolved). createResource keeps the prior value during a
  // refetch by design — we explicitly null it here.
  mutateWorkingTreeStatus(undefined);
  // Same reasoning for the undo/redo button state — the previous
  // repo's `Undo` label would otherwise flash on the toolbar until
  // the new sidecar fetch resolves.
  mutateUndoRedoState(undefined);
  // Filter chips persist per-repo — reload the new repo's saved
  // filter (or fall back to empty when the repo has none).
  reloadCommitFilterForRepo();
}
