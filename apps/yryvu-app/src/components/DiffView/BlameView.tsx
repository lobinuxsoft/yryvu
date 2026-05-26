// SPDX-License-Identifier: AGPL-3.0-or-later

import { createVirtualizer } from "@tanstack/solid-virtual";
import { For, type JSX, Show } from "solid-js";

import type { BlameLine } from "../../ipc";
import { highlightLine } from "./highlight";

interface BlameViewProps {
  lines: BlameLine[];
  language?: string;
  /// Called when the user clicks a blame annotation. Frontend wires
  /// this to open that commit in the graph + diff view.
  onJumpToCommit?: (sha: string) => void;
  /// Optional explicit scroll container. When omitted, the view picks
  /// its own scrolling parent — useful so the parent tab's body owns
  /// the scrollbar (matches the rest of the diff modes).
  scrollParentRef?: HTMLElement;
}

const ROW_PX = 22;
/// Rows past the visible window kept warm. Bigger than typical
/// scroll-jump distance so jumping by Page or Home/End doesn't flash
/// blanks; small enough that 50k-line files stay snappy.
const OVERSCAN = 30;

function formatDate(unixSeconds: number): string {
  if (!unixSeconds) return "";
  const d = new Date(unixSeconds * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/// Virtualized blame view. Each row mounts the annotation columns
/// (author / date / sha) + the file line content with syntax
/// highlighting. Runs of consecutive same-sha lines collapse their
/// author/date columns to blank — mirrors GitKraken.
export function BlameView(props: BlameViewProps): JSX.Element {
  let scrollerRef: HTMLDivElement | undefined;

  const virtualizer = createVirtualizer({
    count: props.lines.length,
    getScrollElement: () => props.scrollParentRef ?? scrollerRef ?? null,
    estimateSize: () => ROW_PX,
    overscan: OVERSCAN,
  });

  const usingExternalScroller = () => Boolean(props.scrollParentRef);

  return (
    <div
      ref={scrollerRef}
      class="blame-view"
      classList={{ "blame-view--scroll": !usingExternalScroller() }}
    >
      <div
        class="blame-view__sizer"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        <For each={virtualizer.getVirtualItems()}>
          {(row) => {
            const line = () => props.lines[row.index];
            const meta = () => {
              const l = line();
              return l.continuesRun
                ? { author: "", date: "", sha: "" }
                : {
                    author: l.authorName,
                    date: formatDate(l.time),
                    sha: l.shortSha,
                  };
            };
            return (
              <div
                class="blame-row"
                style={{ transform: `translateY(${row.start}px)`, height: `${ROW_PX}px` }}
                data-line={line().lineNo}
              >
                <button
                  class="blame-row__meta"
                  type="button"
                  title={
                    line().continuesRun
                      ? ""
                      : `${line().authorName} <${line().authorEmail}>\n${line().summary}`
                  }
                  disabled={line().continuesRun}
                  onClick={() => props.onJumpToCommit?.(line().sha)}
                >
                  <span class="blame-row__author">{meta().author}</span>
                  <span class="blame-row__date">{meta().date}</span>
                  <span class="blame-row__sha">{meta().sha}</span>
                </button>
                <span class="blame-row__lineno">{line().lineNo}</span>
                <span
                  class="blame-row__content"
                  innerHTML={highlightLine(line().content, props.language)}
                />
              </div>
            );
          }}
        </For>
      </div>
      <Show when={props.lines.length === 0}>
        <div class="diff-file__notice">
          No blame data available for this revision.
        </div>
      </Show>
    </div>
  );
}
