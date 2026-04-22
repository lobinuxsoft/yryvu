// SPDX-License-Identifier: AGPL-3.0-or-later

import { createEffect, createMemo, createSignal, onCleanup, Show } from "solid-js";

import { open as openDialog } from "@tauri-apps/plugin-dialog";

import {
  getHostingService,
  streamGraph,
  type GraphRow,
  type HostingService,
} from "../../ipc";
import {
  commitMessage,
  dirtyFileCount,
  graphNonce,
  hoveredRef,
  inspectorMode,
  selectedCommit,
  setCommitMessage,
  setInspectorMode,
  setSelectedCommit,
} from "../../state";
import { isRowMemberOfHoveredRef } from "./hoverDim";
import { ContextMenu } from "../ContextMenu";
import { CommitDialogs } from "./CommitDialogs";
import { createCommitOps } from "./useCommitOps";
import { RefPillGroup } from "./RefPills";
import {
  CommitRowGraph,
  GUTTER,
  LANE_WIDTH,
  ROW_HEIGHT,
} from "./RowRenderer";
import { buildEdgeStates } from "./edgeStates";

/**
 * Module-level className cache (Bd pattern from doc 12 — row wrapper).
 * Keyed by `type + isHovering + isSelected` concatenation. Solid's reactivity
 * is granular enough to avoid needing this strictly, but adopting matches
 * GitKraken's render hot-path optimization for 1:1 parity.
 */
const rowWrapperClassCache = new Map<string, string>();
function rowWrapperClass(
  type: "commit" | "merge" | "wip",
  isHovering: boolean,
  isSelected: boolean,
): string {
  const key = `${type}|${isHovering ? 1 : 0}|${isSelected ? 1 : 0}`;
  let cls = rowWrapperClassCache.get(key);
  if (cls) return cls;
  const parts = ["graph-row-wrapper", `graph-row-wrapper--${type}`];
  if (isHovering) parts.push("is-hovering");
  if (isSelected) parts.push("is-selected");
  cls = parts.join(" ");
  rowWrapperClassCache.set(key, cls);
  return cls;
}

export interface CommitGraphProps {
  repoPath: string;
}

export function CommitGraph(props: CommitGraphProps) {
  const [rows, setRows] = createSignal<GraphRow[]>([]);
  const [hoveredCommit, setHoveredCommit] = createSignal<string | undefined>(
    undefined,
  );
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | undefined>(undefined);
  /**
   * Provider tag for the repo's primary remote. Re-queried whenever the
   * repo path changes. Drives avatar URL resolution per row — `"github"`
   * routes through the GitHub CDN's email endpoint (no API auth needed),
   * anything else falls back to Gravatar.
   */
  const [hostingService, setHostingService] =
    createSignal<HostingService>("unknown");

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

  // (Re-)stream the commit graph whenever the repo path or graphNonce changes.
  createEffect(() => {
    const path = props.repoPath;
    graphNonce();
    setRows([]);
    setLoading(true);
    setError(undefined);
    const handle = streamGraph(path, (batch) => {
      setRows((prev) => prev.concat(batch));
    });
    handle.promise
      .then(() => setLoading(false))
      .catch((e) => {
        setLoading(false);
        setError(String(e));
      });
    onCleanup(() => handle.stop());
  });

  // Detect the hosting-service tag once per repo path change. One-shot
  // query — the remote doesn't change while the graph is being rendered.
  createEffect(() => {
    const path = props.repoPath;
    setHostingService("unknown");
    getHostingService(path)
      .then(setHostingService)
      .catch(() => setHostingService("unknown"));
  });

  const totalHeight = () => rows().length * ROW_HEIGHT;
  // HEAD row's lane is needed for the WIP dashed node alignment — pick the
  // topmost row's lane (newest commit = HEAD).
  const headLane = createMemo(() => rows()[0]?.lane ?? 0);
  const wipNodeX = () => GUTTER + headLane() * LANE_WIDTH + LANE_WIDTH / 2;

  /**
   * Per-row edges dict — literal port of GitKraken's
   * `getFinalEdgeStateForGraphAndRow` pipeline. Each row gets a
   * `Map<column, {starting?, passThrough?, ending?}>` that the renderer
   * iterates to dispatch one of three drawing primitives per column.
   *
   * Built in one pass over `rows()` so it's O(n·k) total; consumed by
   * index-based lookup when rendering each row.
   */
  const edgeStates = createMemo(() => buildEdgeStates(rows()));

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
              style={{ left: `${wipNodeX()}px` }}
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
      <div class="commit-graph__scroll">
        <div class="commit-graph__grid" style={{ height: `${totalHeight()}px` }}>
          <ul class="commit-graph__col-branch">
            {rows().map((r, i) => (
              <li
                class={rowWrapperClass(
                  r.is_merge ? "merge" : "commit",
                  hoveredCommit() === r.sha,
                  selectedCommit() === r.sha,
                )}
                classList={{
                  "is-dimmed": !isRowMemberOfHoveredRef(r, hoveredRef()),
                }}
                data-selected={selectedCommit() === r.sha ? "true" : "false"}
                style={{
                  top: `${i * ROW_HEIGHT}px`,
                  height: `${ROW_HEIGHT}px`,
                }}
                onMouseEnter={() => setHoveredCommit(r.sha)}
                onMouseLeave={() => {
                  if (hoveredCommit() === r.sha) setHoveredCommit(undefined);
                }}
              >
                <RefPillGroup refs={r.refs} />
                {/* Connector line (#127) — fills the gap between the last
                    pill and the right edge of the BRANCH/TAG cell, tinted
                    with the row's lane color. Anchors each pill cluster
                    visually to its commit. The line continues inside the
                    GRAPH column's SVG up to the commit circle. HEAD rows
                    get a 2-px variant as a "you are here" cue, matching
                    GitKraken's thicker stroke on the checked-out branch. */}
                <Show when={r.refs.length > 0}>
                  <span
                    class="ref-connector"
                    classList={{
                      "ref-connector--head": r.refs.some(
                        (ref) => ref.kind === "Head",
                      ),
                    }}
                    aria-hidden="true"
                    style={{
                      "background-color": `var(--column-${r.color_idx % 10}-color)`,
                    }}
                  />
                </Show>
              </li>
            ))}
          </ul>
          <ul class="commit-graph__col-graph">
            {rows().map((r, i) => (
              <li
                class={rowWrapperClass(
                  r.is_merge ? "merge" : "commit",
                  hoveredCommit() === r.sha,
                  selectedCommit() === r.sha,
                )}
                classList={{
                  "is-dimmed": !isRowMemberOfHoveredRef(r, hoveredRef()),
                }}
                data-selected={selectedCommit() === r.sha ? "true" : "false"}
                style={{
                  top: `${i * ROW_HEIGHT}px`,
                  height: `${ROW_HEIGHT}px`,
                }}
                onClick={() => setSelectedCommit(r.sha)}
                onMouseEnter={() => setHoveredCommit(r.sha)}
                onMouseLeave={() => {
                  if (hoveredCommit() === r.sha) setHoveredCommit(undefined);
                }}
              >
                <CommitRowGraph
                  row={r}
                  edges={edgeStates()[i] ?? new Map()}
                  hostingService={hostingService()}
                />
              </li>
            ))}
          </ul>
          <ul class="commit-graph__col-messages">
            {rows().map((r, i) => (
              <li
                class={rowWrapperClass(
                  r.is_merge ? "merge" : "commit",
                  hoveredCommit() === r.sha,
                  selectedCommit() === r.sha,
                )}
                classList={{
                  "is-dimmed": !isRowMemberOfHoveredRef(r, hoveredRef()),
                }}
                data-selected={selectedCommit() === r.sha ? "true" : "false"}
                style={{
                  top: `${i * ROW_HEIGHT}px`,
                  height: `${ROW_HEIGHT}px`,
                }}
                onClick={() => setSelectedCommit(r.sha)}
                onMouseEnter={() => setHoveredCommit(r.sha)}
                onMouseLeave={() => {
                  if (hoveredCommit() === r.sha) setHoveredCommit(undefined);
                }}
                onContextMenu={(e) =>
                  ops.openCommitContextMenu(e, r.sha, r.short_sha)
                }
              >
                <span class="commit-graph__sha">{r.short_sha}</span>
                <span class="commit-graph__summary">{r.summary}</span>
                <span class="commit-graph__author">{r.author_name}</span>
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
