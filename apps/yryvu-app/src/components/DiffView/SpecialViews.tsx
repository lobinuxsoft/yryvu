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

/// Banner shown above a deleted text file's original-only content
/// (research doc 11). GitKraken's own string key is
/// `FileContentsPanel-Deleted` ("File was deleted"); issue #60 specifies
/// the banner copy "This file was deleted." verbatim, which wins per the
/// "issue spec > GK fidelity" tie-break.
export function DeletedFileBanner(): JSX.Element {
  return <div class="diff-file__deleted-banner">This file was deleted.</div>;
}
