// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, For, Show } from "solid-js";

import type { PrFile } from "../../ipc";

interface FilesProps {
  files: PrFile[];
}

const STATUS_LABEL: Record<string, string> = {
  added: "added",
  modified: "modified",
  removed: "removed",
  renamed: "renamed",
  copied: "copied",
  changed: "changed",
  unchanged: "unchanged",
};

/// Lightweight diff renderer — colour the leading + / - / @ char per
/// line. No language highlighting (deferred — Prism is overkill for
/// the v1 surface; users who want full syntax open the file in their
/// editor via "Open in browser" or the existing DiffView).
function renderPatch(patch: string) {
  const lines = patch.split("\n");
  return (
    <pre class="pr-detail__file-patch">
      <For each={lines}>
        {(line) => {
          const cls = line.startsWith("+")
            ? "pr-detail__file-patch-add"
            : line.startsWith("-")
              ? "pr-detail__file-patch-del"
              : line.startsWith("@@")
                ? "pr-detail__file-patch-hunk"
                : "pr-detail__file-patch-context";
          return <span class={cls}>{line + "\n"}</span>;
        }}
      </For>
    </pre>
  );
}

function FileRow(props: { file: PrFile }) {
  const file = () => props.file;
  const [expanded, setExpanded] = createSignal(false);
  const canExpand = () => file().patch !== null && file().patch !== "";
  return (
    <li class="pr-detail__file-row">
      <button
        type="button"
        class="pr-detail__file-header"
        onClick={() => canExpand() && setExpanded((v) => !v)}
        data-expandable={canExpand() ? "true" : "false"}
      >
        <Show when={canExpand()}>
          <span class="pr-detail__file-chevron">{expanded() ? "▾" : "▸"}</span>
        </Show>
        <span
          class="pr-detail__file-status"
          data-status={file().status}
        >
          {STATUS_LABEL[file().status] ?? file().status}
        </span>
        <code class="pr-detail__file-name">
          <Show when={file().previousFilename}>
            {(prev) => (
              <span class="pr-detail__file-rename">
                {prev()} <span class="pr-detail__file-arrow">→</span>{" "}
              </span>
            )}
          </Show>
          {file().filename}
        </code>
        <span class="pr-detail__file-counts">
          <span class="pr-detail__diff-add">+{file().additions}</span>
          {" "}
          <span class="pr-detail__diff-del">-{file().deletions}</span>
        </span>
      </button>
      <Show when={expanded() && file().patch}>
        {(patch) => renderPatch(patch())}
      </Show>
    </li>
  );
}

export function Files(props: FilesProps) {
  return (
    <Show
      when={props.files.length > 0}
      fallback={
        <p class="pr-detail__empty">No file changes reported.</p>
      }
    >
      <ul class="pr-detail__files">
        <For each={props.files}>{(f) => <FileRow file={f} />}</For>
      </ul>
    </Show>
  );
}
