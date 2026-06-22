// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, For, type JSX, Show } from "solid-js";

import type { BlameLine, CommitDiff, DiffLine, FileDiff, FileStatus } from "../../ipc";
import { BlameView } from "./BlameView";
import {
  FileContentView,
  FullFileMissing,
  InlineFullFileView,
} from "./FullFileView";
import { detectLanguage, highlightLine } from "./highlight";
import { HunkActions, type HunkStagingActions } from "./HunkActions";
import { LineActions, type LineStagingApi } from "./LineActions";
import { BinaryDiffView, DeletedFileBanner } from "./SpecialViews";
import { pairLines, SplitLineRow } from "./SplitView";

export type { HunkStagingActions, LineStagingApi };

function statusLabel(status: FileStatus): { label: string; tone: string } {
  switch (status) {
    case "added":
      return { label: "A", tone: "added" };
    case "modified":
      return { label: "M", tone: "modified" };
    case "deleted":
      return { label: "D", tone: "deleted" };
    case "renamed":
      return { label: "R", tone: "renamed" };
    case "copied":
      return { label: "C", tone: "renamed" };
    case "type-change":
      return { label: "T", tone: "modified" };
    default:
      return { label: "·", tone: "modified" };
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/// GitKraken parity (issue #59 + #8). `fileDisplayModes` in the bundle
/// plus the Blame mode added as a 3rd outer-toggle slot in yryvu:
///
/// - `content` — File View: current file content, no diff markers.
/// - `hunk` — Hunk View (default): only changed hunks, stacked.
/// - `inline` — full file, unified `+`/`-` markers on changed lines.
/// - `split` — side-by-side, original left / modified right.
/// - `blame` — per-line authorship annotations over file content.
///
/// Monaco's `renderSideBySide` is `mode === "split"`. The HUNK/INLINE
/// distinction is which model is rendered (hunks-only vs full file).
export type FileViewMode = "content" | "hunk" | "inline" | "split" | "blame";

/// Subset usable as diff (toolbar's inner toggle).
export const DIFF_VIEW_MODES = ["hunk", "inline", "split"] as const;
export type DiffViewMode = (typeof DIFF_VIEW_MODES)[number];

export interface DiffFileBlockProps {
  file: FileDiff;
  /**
   * When true, skip the collapsible header and always show content.
   * Used by `FileDiffTab` when a single file is rendered full-width in the
   * main area — the tab supplies its own header (breadcrumb + close).
   */
  headless?: boolean;
  alwaysExpanded?: boolean;
  /**
   * `hunk` (default) renders only the changed hunks stacked. `inline`
   * renders the full file with `+`/`-` markers. `split` renders the
   * original / modified side-by-side. `content` skips diff and shows
   * the raw file content. INLINE / CONTENT both require `fullContent`
   * / `originalContent` props since hunks alone don't carry context
   * lines outside the hunk window.
   */
  viewMode?: FileViewMode;
  /**
   * Modified-side full content. Required when `viewMode === "inline"`
   * (full file with `+`/`-` markers) or `viewMode === "content"`
   * (no-diff file view). Ignored for HUNK / SPLIT.
   */
  fullContent?: string;
  /**
   * Original-side full content. Reserved for future SPLIT-with-context
   * upgrades; currently ignored.
   */
  originalContent?: string;
  /**
   * Per-line blame entries used when `viewMode === "blame"`. The blame
   * fetch lives in the parent — the renderer just consumes the array.
   */
  blameLines?: BlameLine[];
  /**
   * Click-through callback when the user activates a blame annotation.
   * The parent (FileDiffTab) opens that commit in the graph + diff
   * view.
   */
  onJumpToBlameCommit?: (sha: string) => void;
  /// When present, renders Stage/Unstage/Discard buttons in each hunk
  /// header. Absent (commit diffs, historical views) means read-only.
  stagingActions?: HunkStagingActions;
  /// When present, renders inline `+`/`−` glyphs on each changed line
  /// to stage/unstage that single line. Independent from
  /// `stagingActions`: a tab usually passes both, but commit diffs pass
  /// neither.
  lineStagingApi?: LineStagingApi;
}

export function DiffFileBlock(props: DiffFileBlockProps): JSX.Element {
  const [expanded, setExpanded] = createSignal(true);
  const isOpen = () => props.alwaysExpanded || expanded();
  const status = () => statusLabel(props.file.status);
  const lang = () => detectLanguage(props.file.path);
  const mode = (): FileViewMode => props.viewMode ?? "hunk";

  return (
    <div class="diff-file" data-status={props.file.status}>
      <Show when={!props.headless}>
        <button
          class="diff-file__header"
          type="button"
          onClick={() => !props.alwaysExpanded && setExpanded((v) => !v)}
        >
          <Show when={!props.alwaysExpanded}>
            <span class="diff-file__caret">{expanded() ? "▾" : "▸"}</span>
          </Show>
          <span class="diff-file__status" data-tone={status().tone}>
            {status().label}
          </span>
          <Show when={props.file.old_path}>
            <span class="diff-file__old-path">{props.file.old_path} →</span>
          </Show>
          <span class="diff-file__path">{props.file.path}</span>
          <Show when={props.file.additions > 0 || props.file.deletions > 0}>
            <span class="diff-file__stats">
              <Show when={props.file.additions > 0}>
                <span class="diff-file__stats--add">+{props.file.additions}</span>
              </Show>
              <Show when={props.file.deletions > 0}>
                <span class="diff-file__stats--del">-{props.file.deletions}</span>
              </Show>
            </span>
          </Show>
        </button>
      </Show>

      <Show when={isOpen()}>{renderByDataType(props, mode(), lang())}</Show>
    </div>
  );
}

/// Per-filetype dispatcher (issue #60). Routes on the backend's
/// `file_data_type` before the text path. Each non-text branch is
/// landing incrementally: the binary placeholder + deleted banner ship
/// here; `image` and `submodule` reuse interim fallbacks until their
/// dedicated viewers land (PR2 image, PR4 submodule pane).
function renderByDataType(
  props: DiffFileBlockProps,
  mode: FileViewMode,
  lang: string | undefined,
): JSX.Element {
  const file = props.file;
  if (file.truncated) {
    return (
      <div class="diff-file__notice">
        File too large ({formatBytes(Math.max(file.new_size, file.old_size))}) —
        diff truncated. Open the file externally to inspect.
      </div>
    );
  }
  switch (file.file_data_type) {
    case "binary":
      return <BinaryDiffView file={file} />;
    case "image":
      // PR2 mounts the side-by-side image viewer; until then images
      // (which are binary) get the same placeholder GitKraken shows.
      return <BinaryDiffView file={file} />;
    case "deleted":
      return (
        <>
          <DeletedFileBanner />
          {renderBody(props, mode, lang)}
        </>
      );
    case "submodule":
    // PR4 mounts the pointer pane; until then fall through to the raw
    // "Subproject commit" hunks, which still convey the OID change.
    case "directory":
    case "text":
      return renderBody(props, mode, lang);
  }
}

function renderBody(
  props: DiffFileBlockProps,
  mode: FileViewMode,
  lang: string | undefined,
): JSX.Element {
  if (mode === "blame") {
    if (props.blameLines === undefined) {
      return <FullFileMissing reason="loading" />;
    }
    return (
      <BlameView
        lines={props.blameLines}
        language={lang}
        onJumpToCommit={props.onJumpToBlameCommit}
      />
    );
  }
  if (mode === "content") {
    if (props.fullContent === undefined) {
      return <FullFileMissing reason="loading" />;
    }
    return <FileContentView content={props.fullContent} language={lang} />;
  }
  if (mode === "inline") {
    if (props.fullContent === undefined) {
      return <FullFileMissing reason="loading" />;
    }
    return (
      <InlineFullFileView
        fullContent={props.fullContent}
        hunks={props.file.hunks}
        language={lang}
      />
    );
  }
  if (props.file.hunks.length === 0) {
    return (
      <div class="diff-file__notice">
        No textual changes (empty file / mode change only).
      </div>
    );
  }
  return (
    <div class="diff-file__hunks" data-view-mode={mode}>
      <For each={props.file.hunks}>
        {(hunk, hunkIdx) => (
          <div class="diff-hunk">
            <div class="diff-hunk__header">
              <span class="diff-hunk__range">{hunk.header}</span>
              <Show when={props.stagingActions}>
                <HunkActions index={hunkIdx()} actions={props.stagingActions!} />
              </Show>
            </div>
            <Show
              when={mode === "split"}
              fallback={
                <For each={hunk.lines}>
                  {(line, lineIdx) => (
                    <DiffLineRow
                      line={line}
                      language={lang}
                      hunkIndex={hunkIdx()}
                      lineIndex={lineIdx()}
                      lineStagingApi={props.lineStagingApi}
                    />
                  )}
                </For>
              }
            >
              <For each={pairLines(hunk.lines)}>
                {(pair) => (
                  <SplitLineRow
                    pair={pair}
                    hunkIndex={hunkIdx()}
                    highlight={(c) => highlightLine(c, lang)}
                    lineStagingApi={props.lineStagingApi}
                  />
                )}
              </For>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

function DiffLineRow(props: {
  line: DiffLine;
  language?: string;
  hunkIndex: number;
  lineIndex: number;
  lineStagingApi?: LineStagingApi;
}): JSX.Element {
  const html = () => highlightLine(props.line.content, props.language);
  return (
    <div class="diff-line" data-kind={props.line.kind}>
      <span class="diff-line__gutter">
        <Show when={props.lineStagingApi}>
          <LineActions
            line={props.line}
            hunkIndex={props.hunkIndex}
            lineIndex={props.lineIndex}
            api={props.lineStagingApi!}
          />
        </Show>
      </span>
      <span class="diff-line__no diff-line__no--old">
        {props.line.old_line_no ?? ""}
      </span>
      <span class="diff-line__no diff-line__no--new">
        {props.line.new_line_no ?? ""}
      </span>
      <span class="diff-line__sigil">
        {props.line.kind === "added" ? "+" : props.line.kind === "removed" ? "-" : " "}
      </span>
      <span class="diff-line__content" innerHTML={html()} />
    </div>
  );
}


interface DiffViewProps {
  diff?: CommitDiff;
  loading?: boolean;
  error?: string;
}

export function DiffView(props: DiffViewProps): JSX.Element {
  return (
    <div class="diff-view">
      <Show when={props.loading}>
        <div class="diff-view__status">Loading diff…</div>
      </Show>
      <Show when={props.error}>
        <div class="diff-view__error">{props.error}</div>
      </Show>
      <Show when={props.diff && !props.loading && !props.error}>
        <Show
          when={props.diff!.files.length > 0}
          fallback={
            <div class="diff-view__status">
              No changes in this commit (possibly a merge with no diff).
            </div>
          }
        >
          <div class="diff-view__summary">
            {props.diff!.files.length} file
            {props.diff!.files.length === 1 ? "" : "s"} changed
            <Show when={props.diff!.parent_sha}>
              <span class="diff-view__parent">
                {" "}
                vs <code>{props.diff!.parent_sha!.slice(0, 7)}</code>
              </span>
            </Show>
          </div>
          <For each={props.diff!.files}>{(f) => <DiffFileBlock file={f} />}</For>
        </Show>
      </Show>
    </div>
  );
}
