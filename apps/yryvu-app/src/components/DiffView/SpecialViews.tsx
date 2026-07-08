// SPDX-License-Identifier: AGPL-3.0-or-later

import { type JSX, Show } from "solid-js";

import type { FileDiff } from "../../ipc";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface SpecialViewProps {
  file: FileDiff;
}

/// `fileDataTypes.BINARY` placeholder. Mirrors GitKraken's
/// `FileContentsPanel-Binary` ("Binary file") plain-viewer copy (research
/// doc 10). No hex viewer by design — users route to external tools via
/// Tool preferences (#105). Also covers the size-cap fallback, where the
/// backend marks the file binary because the diff exceeded the 10 MB cap.
export function BinaryDiffView(props: SpecialViewProps): JSX.Element {
  const size = () => props.file.new_size || props.file.old_size;
  return (
    <div class="diff-file__special diff-file__special--binary">
      <span class="diff-file__special-title">Binary file</span>
      <Show when={size() > 0}>
        <span class="diff-file__special-meta">{formatBytes(size())}</span>
      </Show>
    </div>
  );
}

/// Git LFS pointer placeholder (research doc 07 + #21). Shows the object
/// size with a Download button that stays disabled until LFS transfer
/// lands (#21, blocked on gix-lfs). Detection is a post-load check on the
/// file content — see `parseLfsPointer`.
export function LfsPointerView(props: { size: number }): JSX.Element {
  return (
    <div class="diff-file__special diff-file__special--lfs">
      <span class="diff-file__special-title">LFS object ({formatBytes(props.size)})</span>
      <button
        type="button"
        class="diff-file__special-btn"
        disabled
        title="LFS transfer is not yet supported (#21)"
      >
        Download
      </button>
    </div>
  );
}

export interface FilemodeStaging {
  side: "staged" | "unstaged";
  onStage: () => void;
  onUnstage: () => void;
}

/// File-mode change pane (research doc 10). Mirrors GitKraken's
/// `FileViewPanel-DiffFileMode` ("File Mode Changes from {0} to {1}").
/// In a staging selection it offers a Stage/Unstage filemode button —
/// a distinct action from content staging.
export function FilemodeView(props: {
  oldMode: string;
  newMode: string;
  staging?: FilemodeStaging;
}): JSX.Element {
  return (
    <div
      class="diff-file__special diff-file__special--filemode"
      data-testid="FileViewPanel-DiffFileMode"
    >
      <span class="diff-file__special-title">
        File Mode Changes from {props.oldMode} to {props.newMode}
      </span>
      <Show when={props.staging}>
        {(staging) => (
          <button
            type="button"
            class="diff-file__special-btn"
            onClick={() =>
              staging().side === "unstaged"
                ? staging().onStage()
                : staging().onUnstage()
            }
          >
            {staging().side === "unstaged" ? "Stage filemode" : "Unstage filemode"}
          </button>
        )}
      </Show>
    </div>
  );
}

/// Banner shown above a deleted text file's original-only content
/// (research doc 11). GitKraken's own string key is
/// `FileContentsPanel-Deleted` ("File was deleted"); issue #60 specifies
/// the banner copy "This file was deleted." verbatim, which wins per the
/// "issue spec > GK fidelity" tie-break.
export function DeletedFileBanner(): JSX.Element {
  return <div class="diff-file__deleted-banner">This file was deleted.</div>;
}
