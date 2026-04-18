// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";

import { streamGraph, type GraphRow } from "../../ipc";
import { selectedCommit, setSelectedCommit } from "../../state";
import { CommitGraphRenderer } from "./renderer";
import { computeVisible } from "./virtualize";

const ROW_HEIGHT = 24;
const LANE_WIDTH = 14;
const GRAPH_COLUMN_WIDTH = 220;

export interface CommitGraphProps {
  repoPath: string;
}

export function CommitGraph(props: CommitGraphProps) {
  const [rows, setRows] = createSignal<GraphRow[]>([]);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportH, setViewportH] = createSignal(0);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | undefined>(undefined);

  let canvas: HTMLCanvasElement | undefined;
  let scrollEl: HTMLDivElement | undefined;
  let renderer: CommitGraphRenderer | undefined;
  let frame = 0;

  onMount(() => {
    if (!canvas || !scrollEl) return;
    try {
      renderer = new CommitGraphRenderer(canvas, {
        rowHeight: ROW_HEIGHT,
        laneWidth: LANE_WIDTH,
        nodeRadius: 5,
        edgeThickness: 2,
      });
    } catch (e) {
      setError(`Renderer init failed: ${String(e)}`);
      return;
    }

    // Force an initial resize synchronously + on the next frame. The WebKit
    // WebView sometimes reports `clientHeight === 0` during the first mount
    // pass; without this the canvas stays at 0×0 until a user-driven resize.
    const applySize = () => {
      if (!canvas || !scrollEl || !renderer) return;
      const w = GRAPH_COLUMN_WIDTH;
      const rect = scrollEl.getBoundingClientRect();
      const h = Math.max(scrollEl.clientHeight, Math.floor(rect.height));
      if (h === 0) return;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      renderer.resize(w, h);
      setViewportH(h);
      scheduleDraw();
    };

    applySize();
    requestAnimationFrame(applySize);
    const ro = new ResizeObserver(() => applySize());
    ro.observe(scrollEl);

    const handle = streamGraph(props.repoPath, (batch) => {
      setRows((prev) => prev.concat(batch));
      scheduleDraw();
    });
    handle.promise
      .then(() => setLoading(false))
      .catch((e) => {
        setLoading(false);
        setError(String(e));
      });

    onCleanup(() => {
      ro.disconnect();
      cancelAnimationFrame(frame);
      handle.stop();
    });
  });

  createEffect(() => {
    rows();
    scrollTop();
    viewportH();
    scheduleDraw();
  });

  function scheduleDraw() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!renderer) return;
      const range = computeVisible(scrollTop(), viewportH(), ROW_HEIGHT, rows().length);
      const slice = rows().slice(range.start, range.end);
      renderer.draw(slice, range.start, scrollTop());
    });
  }

  const totalHeight = () => rows().length * ROW_HEIGHT;

  return (
    <div class="commit-graph">
      <Show when={error()}>
        <div class="commit-graph__error">Error: {error()}</div>
      </Show>
      <Show when={loading()}>
        <div class="commit-graph__status">Loading…</div>
      </Show>
      <div
        class="commit-graph__scroll"
        ref={(el) => (scrollEl = el)}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div class="commit-graph__spacer" style={{ height: `${totalHeight()}px` }}>
          <canvas
            class="commit-graph__canvas"
            ref={(el) => (canvas = el)}
          />
          <ul class="commit-graph__list" style={{ "margin-left": `${GRAPH_COLUMN_WIDTH}px` }}>
            {rows().map((r, i) => (
              <li
                class="commit-graph__row"
                data-selected={selectedCommit() === r.sha ? "true" : "false"}
                style={{
                  position: "absolute",
                  top: `${i * ROW_HEIGHT}px`,
                  height: `${ROW_HEIGHT}px`,
                  left: `${GRAPH_COLUMN_WIDTH}px`,
                  right: "0",
                }}
                onClick={() => setSelectedCommit(r.sha)}
              >
                <span class="commit-graph__sha">{r.short_sha}</span>
                <span class="commit-graph__summary">{r.summary}</span>
                <span class="commit-graph__author">{r.author}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
