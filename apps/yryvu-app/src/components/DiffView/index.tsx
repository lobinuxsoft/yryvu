// SPDX-License-Identifier: AGPL-3.0-or-later

import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import toml from "highlight.js/lib/languages/ini";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { createSignal, For, type JSX, Show } from "solid-js";

import type { CommitDiff, DiffLine, FileDiff, FileStatus } from "../../ipc";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("go", go);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("shell", shell);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("toml", toml);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

const EXTENSION_TO_LANG: Record<string, string> = {
  rs: "rust",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  go: "go",
  css: "css",
  scss: "css",
  json: "json",
  md: "markdown",
  markdown: "markdown",
  sh: "bash",
  bash: "bash",
  zsh: "shell",
  sql: "sql",
  toml: "toml",
  ini: "toml",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  yaml: "yaml",
  yml: "yaml",
};

function detectLanguage(path: string): string | undefined {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return undefined;
  const ext = path.slice(dot + 1).toLowerCase();
  return EXTENSION_TO_LANG[ext];
}

function highlightLine(content: string, lang: string | undefined): string {
  if (content.length === 0) return "";
  if (!lang) return escapeHtml(content);
  try {
    return hljs.highlight(content, { language: lang, ignoreIllegals: true }).value;
  } catch {
    return escapeHtml(content);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

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

export type DiffViewMode = "unified" | "split";

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
   * `unified` is the single-column view with +/- sigils (default, good for
   * narrow panels). `split` is the side-by-side GitKraken-style view
   * (old on the left, new on the right); better for wide surfaces.
   */
  viewMode?: DiffViewMode;
}

export function DiffFileBlock(props: DiffFileBlockProps): JSX.Element {
  const [expanded, setExpanded] = createSignal(true);
  const isOpen = () => props.alwaysExpanded || expanded();
  const status = () => statusLabel(props.file.status);
  const lang = () => detectLanguage(props.file.path);

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

      <Show when={isOpen()}>
        <Show when={props.file.is_binary}>
          <div class="diff-file__notice">
            Binary file — not shown. ({formatBytes(props.file.new_size || props.file.old_size)})
          </div>
        </Show>
        <Show when={!props.file.is_binary && props.file.truncated}>
          <div class="diff-file__notice">
            File too large ({formatBytes(Math.max(props.file.new_size, props.file.old_size))})
            — diff truncated. Open the file externally to inspect.
          </div>
        </Show>
        <Show
          when={
            !props.file.is_binary &&
            !props.file.truncated &&
            props.file.hunks.length > 0
          }
        >
          <div
            class="diff-file__hunks"
            data-view-mode={props.viewMode ?? "unified"}
          >
            <For each={props.file.hunks}>
              {(hunk) => (
                <div class="diff-hunk">
                  <div class="diff-hunk__header">{hunk.header}</div>
                  <Show
                    when={props.viewMode === "split"}
                    fallback={
                      <For each={hunk.lines}>
                        {(line) => <DiffLineRow line={line} language={lang()} />}
                      </For>
                    }
                  >
                    <For each={pairLines(hunk.lines)}>
                      {(pair) => (
                        <SplitLineRow pair={pair} language={lang()} />
                      )}
                    </For>
                  </Show>
                </div>
              )}
            </For>
          </div>
        </Show>
        <Show
          when={
            !props.file.is_binary &&
            !props.file.truncated &&
            props.file.hunks.length === 0
          }
        >
          <div class="diff-file__notice">
            No textual changes (empty file / mode change only).
          </div>
        </Show>
      </Show>
    </div>
  );
}

function DiffLineRow(props: { line: DiffLine; language?: string }): JSX.Element {
  const html = () => highlightLine(props.line.content, props.language);
  return (
    <div class="diff-line" data-kind={props.line.kind}>
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

interface SplitPair {
  left: DiffLine | null;
  right: DiffLine | null;
}

/**
 * Walk unified-diff lines and pair them into split-view rows.
 * Context lines go to both columns. A block of N removed followed by M added
 * is zipped: rows 1..min(N,M) pair them, rows beyond one side get `null` on
 * the other. This matches the GitKraken side-by-side behaviour.
 */
function pairLines(lines: DiffLine[]): SplitPair[] {
  const rows: SplitPair[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.kind === "context") {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (i < lines.length && lines[i].kind === "removed") {
      removed.push(lines[i]);
      i++;
    }
    while (i < lines.length && lines[i].kind === "added") {
      added.push(lines[i]);
      i++;
    }
    const pairs = Math.max(removed.length, added.length);
    for (let j = 0; j < pairs; j++) {
      rows.push({
        left: removed[j] ?? null,
        right: added[j] ?? null,
      });
    }
  }
  return rows;
}

function SplitLineRow(props: {
  pair: SplitPair;
  language?: string;
}): JSX.Element {
  const leftHtml = () =>
    props.pair.left ? highlightLine(props.pair.left.content, props.language) : "";
  const rightHtml = () =>
    props.pair.right ? highlightLine(props.pair.right.content, props.language) : "";
  const leftKind = () => props.pair.left?.kind ?? "empty";
  const rightKind = () => props.pair.right?.kind ?? "empty";
  return (
    <div class="diff-split-row">
      <div class="diff-split-cell" data-kind={leftKind()}>
        <span class="diff-line__no">{props.pair.left?.old_line_no ?? ""}</span>
        <span class="diff-line__content" innerHTML={leftHtml()} />
      </div>
      <div class="diff-split-cell" data-kind={rightKind()}>
        <span class="diff-line__no">{props.pair.right?.new_line_no ?? ""}</span>
        <span class="diff-line__content" innerHTML={rightHtml()} />
      </div>
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
