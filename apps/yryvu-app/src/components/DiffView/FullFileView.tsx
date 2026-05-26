// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, type JSX } from "solid-js";

import type { DiffHunk } from "../../ipc";
import { highlightLine } from "./highlight";

/// Markers applied to each line of the modified-side full file when
/// projecting a diff onto it. Mirrors GitKraken's INLINE mode where the
/// gutter sigils flow over the entire file, not just hunk windows.
type LineMarker = "added" | "context" | "removed";

interface MarkedLine {
  content: string;
  marker: LineMarker;
  /// 1-based line number on the modified side; `null` for `removed`
  /// lines (they don't exist in the modified file).
  newLineNo: number | null;
  /// 1-based line number on the original side; `null` for `added`.
  oldLineNo: number | null;
}

/// Project the diff hunks onto the modified-side full file so every
/// line carries a marker. Lines outside any hunk are `context`; added /
/// removed lines come from the hunk metadata directly.
///
/// We walk the modified file once; whenever a hunk starts at the
/// current new-line cursor we splice the hunk's `+` / `-` / ` ` lines
/// in. Removed lines are inserted *between* full-file lines (they have
/// no modified-side position), preserving GK's visual order.
export function buildInlineMarkedLines(
  fullModified: string,
  hunks: DiffHunk[],
): MarkedLine[] {
  const fileLines = fullModified.split("\n");
  // Trailing newline yields a final empty element; drop it so we don't
  // render a phantom line at the bottom.
  if (fileLines.length > 0 && fileLines[fileLines.length - 1] === "") {
    fileLines.pop();
  }

  const byStart = new Map<number, DiffHunk>();
  for (const h of hunks) byStart.set(h.new_start, h);

  const out: MarkedLine[] = [];
  let i = 0; // 0-based index into fileLines
  while (i < fileLines.length) {
    const newLineNo = i + 1;
    const hunk = byStart.get(newLineNo);
    if (hunk) {
      for (const line of hunk.lines) {
        out.push({
          content: line.content,
          marker: line.kind,
          newLineNo: line.new_line_no,
          oldLineNo: line.old_line_no,
        });
      }
      // Skip over the hunk's modified-side window in the full file
      // since we've already emitted those lines from the hunk.
      i += hunk.new_count;
      continue;
    }
    out.push({
      content: fileLines[i],
      marker: "context",
      newLineNo,
      oldLineNo: null,
    });
    i++;
  }

  // Append trailing hunks past EOF (rare — pure-addition trailers).
  for (const h of hunks) {
    if (h.new_start > fileLines.length) {
      for (const line of h.lines) {
        out.push({
          content: line.content,
          marker: line.kind,
          newLineNo: line.new_line_no,
          oldLineNo: line.old_line_no,
        });
      }
    }
  }

  return out;
}

interface MarkerSigil {
  glyph: string;
  kind: LineMarker;
}

function sigil(marker: LineMarker): MarkerSigil {
  switch (marker) {
    case "added":
      return { glyph: "+", kind: "added" };
    case "removed":
      return { glyph: "-", kind: "removed" };
    default:
      return { glyph: " ", kind: "context" };
  }
}

interface InlineFullFileViewProps {
  fullContent: string;
  hunks: DiffHunk[];
  language?: string;
}

/// INLINE mode body. Full modified-side file with `+` / `-` / ` `
/// gutter markers. Shares the `.diff-line` styling with HUNK so colors
/// stay coherent.
export function InlineFullFileView(props: InlineFullFileViewProps): JSX.Element {
  const lines = () => buildInlineMarkedLines(props.fullContent, props.hunks);
  return (
    <div class="diff-file__inline-full">
      <For each={lines()}>
        {(line) => {
          const s = sigil(line.marker);
          const html = highlightLine(line.content, props.language);
          return (
            <div class="diff-line" data-kind={s.kind}>
              <span class="diff-line__gutter" />
              <span class="diff-line__no diff-line__no--old">
                {line.oldLineNo ?? ""}
              </span>
              <span class="diff-line__no diff-line__no--new">
                {line.newLineNo ?? ""}
              </span>
              <span class="diff-line__sigil">{s.glyph}</span>
              <span class="diff-line__content" innerHTML={html} />
            </div>
          );
        }}
      </For>
    </div>
  );
}

interface ContentViewProps {
  content: string;
  language?: string;
}

/// CONTENT mode body. Plain file content, no diff markers, no gutter
/// sigil. Read-only — yryvu doesn't ship a Monaco editor surface yet,
/// so the dirty-file gate from GK's saga is a no-op here.
export function FileContentView(props: ContentViewProps): JSX.Element {
  const lines = () => {
    const split = props.content.split("\n");
    if (split.length > 0 && split[split.length - 1] === "") split.pop();
    return split;
  };
  return (
    <div class="diff-file__content-view">
      <For each={lines()}>
        {(line, idx) => {
          const html = highlightLine(line, props.language);
          return (
            <div class="diff-line" data-kind="context">
              <span class="diff-line__gutter" />
              <span class="diff-line__no diff-line__no--new">{idx() + 1}</span>
              <span class="diff-line__sigil"> </span>
              <span class="diff-line__content" innerHTML={html} />
            </div>
          );
        }}
      </For>
    </div>
  );
}

interface FullFileMissingProps {
  /// Reason we couldn't render the full file. Drives copy.
  reason: "binary" | "truncated" | "missing" | "loading" | "error";
  /// Optional error string when `reason === "error"`.
  detail?: string;
  /// File size in bytes for `binary` / `truncated` reasons.
  size?: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FullFileMissing(props: FullFileMissingProps): JSX.Element {
  switch (props.reason) {
    case "binary":
      return (
        <div class="diff-file__notice">
          Binary file — full content view not available
          {props.size ? ` (${formatBytes(props.size)}).` : "."}
        </div>
      );
    case "truncated":
      return (
        <div class="diff-file__notice">
          File too large ({props.size ? formatBytes(props.size) : "unknown"}) —
          full content view truncated. Switch to Hunk view or open externally.
        </div>
      );
    case "missing":
      return (
        <div class="diff-file__notice">
          File not present at the requested revision.
        </div>
      );
    case "loading":
      return <div class="diff-file__notice">Loading file content…</div>;
    case "error":
      return (
        <div class="diff-file__notice diff-file__notice--error">
          Failed to load file content
          {props.detail ? `: ${props.detail}` : "."}
        </div>
      );
  }
}
