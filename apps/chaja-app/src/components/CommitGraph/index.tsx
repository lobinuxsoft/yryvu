// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, createMemo, createSignal, onCleanup, onMount, Show } from "solid-js";

import { open as openDialog } from "@tauri-apps/plugin-dialog";

import { streamGraph, type GraphRow } from "../../ipc";
import {
  commitMessage,
  dirtyFileCount,
  graphNonce,
  inspectorMode,
  selectedCommit,
  setCommitMessage,
  setInspectorMode,
  setSelectedCommit,
} from "../../state";
import { ContextMenu } from "../ContextMenu";
import { CommitDialogs } from "./CommitDialogs";
import { createCommitOps } from "./useCommitOps";
import { CommitGraphRenderer } from "./renderer";
import { computeVisible } from "./virtualize";

const ROW_HEIGHT = 24;
const LANE_WIDTH = 14;

export interface CommitGraphProps {
  repoPath: string;
}

export function CommitGraph(props: CommitGraphProps) {
  const [rows, setRows] = createSignal<GraphRow[]>([]);
  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportH, setViewportH] = createSignal(0);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | undefined>(undefined);

  const ops = createCommitOps({
    copyText: (text) => navigator.clipboard.writeText(text),
    pickSaveDir: async () => {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        title: "Choose output directory for the patch",
      });
      if (!selected) return null;
      return Array.isArray(selected) ? selected[0] ?? null : selected;
    },
  });

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
      const w = Math.floor(canvas.getBoundingClientRect().width);
      const rect = scrollEl.getBoundingClientRect();
      const h = Math.max(scrollEl.clientHeight, Math.floor(rect.height));
      if (h === 0 || w === 0) return;
      canvas.style.height = `${h}px`;
      renderer.resize(w, h);
      setViewportH(h);
      scheduleDraw();
    };

    applySize();
    requestAnimationFrame(applySize);
    const ro = new ResizeObserver(() => applySize());
    ro.observe(scrollEl);
    ro.observe(canvas);

    onCleanup(() => {
      ro.disconnect();
      cancelAnimationFrame(frame);
    });
  });

  // (Re-)stream the commit graph whenever the repo path or graphNonce changes.
  createEffect(() => {
    const path = props.repoPath;
    graphNonce();
    setRows([]);
    setLoading(true);
    setError(undefined);
    const handle = streamGraph(path, (batch) => {
      setRows((prev) => prev.concat(batch));
      scheduleDraw();
    });
    handle.promise
      .then(() => setLoading(false))
      .catch((e) => {
        setLoading(false);
        setError(String(e));
      });
    onCleanup(() => handle.stop());
  });

  createEffect(() => {
    rows();
    scrollTop();
    viewportH();
    scheduleDraw();
  });

  const shaToRow = createMemo(() => {
    const map = new Map<string, number>();
    const list = rows();
    for (let i = 0; i < list.length; i++) map.set(list[i].sha, i);
    return map;
  });

  function scheduleDraw() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!renderer) return;
      const range = computeVisible(scrollTop(), viewportH(), ROW_HEIGHT, rows().length);
      const slice = rows().slice(range.start, range.end);
      renderer.draw(slice, range.start, scrollTop(), shaToRow());
    });
  }

  const totalHeight = () => rows().length * ROW_HEIGHT;

  function openStaging() {
    setSelectedCommit(undefined);
    setInspectorMode("staging");
  }

  return (
    <div class="commit-graph">
      <Show when={error()}>
        <div class="commit-graph__error">Error: {error()}</div>
      </Show>
      <Show when={loading()}>
        <div class="commit-graph__status">Loading…</div>
      </Show>
      <Show when={dirtyFileCount() > 0}>
        <div
          class="commit-graph__wip-row"
          data-active={inspectorMode() === "staging" ? "true" : "false"}
          onClick={() => openStaging()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              openStaging();
            }
          }}
          title="View working-directory changes"
        >
          <div class="commit-graph__wip-col-branch" aria-hidden="true" />
          <div class="commit-graph__wip-lane">
            <span
              class="commit-graph__wip-node"
              aria-hidden="true"
              style={{ left: `${((rows()[0]?.lane ?? 0) + 1) * LANE_WIDTH}px` }}
            />
          </div>
          <div class="commit-graph__wip-message">
            <input
              class="commit-graph__wip-input"
              type="text"
              placeholder="// WIP"
              value={commitMessage()}
              onInput={(e) => setCommitMessage(e.currentTarget.value)}
              onClick={(e) => e.stopPropagation()}
            />
            <span class="commit-graph__wip-pencil" aria-hidden="true">✎</span>
            <span class="commit-graph__wip-badge">{dirtyFileCount()}</span>
          </div>
        </div>
      </Show>
      <div
        class="commit-graph__scroll"
        ref={(el) => (scrollEl = el)}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div class="commit-graph__grid" style={{ height: `${totalHeight()}px` }}>
          <div class="commit-graph__col-branch" aria-hidden="true" />
          <div class="commit-graph__col-graph">
            <canvas
              class="commit-graph__canvas"
              ref={(el) => (canvas = el)}
            />
          </div>
          <ul class="commit-graph__col-messages">
            {rows().map((r, i) => (
              <li
                class="commit-graph__row"
                data-selected={selectedCommit() === r.sha ? "true" : "false"}
                style={{
                  top: `${i * ROW_HEIGHT}px`,
                  height: `${ROW_HEIGHT}px`,
                }}
                onClick={() => setSelectedCommit(r.sha)}
                onContextMenu={(e) =>
                  ops.openCommitContextMenu(e, r.sha, r.short_sha)
                }
              >
                <span class="commit-graph__sha">{r.short_sha}</span>
                <span class="commit-graph__summary">{r.summary}</span>
                <span class="commit-graph__author">{r.author}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <Show when={ops.menu()}>
        <ContextMenu
          x={ops.menu()!.x}
          y={ops.menu()!.y}
          items={ops.menu()!.items}
          onClose={() => ops.setMenu(null)}
        />
      </Show>
      <CommitDialogs ops={ops} />
    </div>
  );
}
