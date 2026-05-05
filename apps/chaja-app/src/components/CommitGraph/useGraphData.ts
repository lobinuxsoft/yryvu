// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  type Accessor,
} from "solid-js";

import {
  getHostingService,
  smartVisibleRefs,
  streamGraph,
  type GraphRow,
  type HostingService,
} from "../../ipc";
import {
  graphNonce,
  setHiddenBySmartFilter,
  setPinnedSha,
  smartBranchesEnabled,
} from "../../state";
import { createIncrementalEdgeStates } from "./edgeStates";

/**
 * Stream the commit graph for the active repo and produce the derived
 * resources / signals every zone reads:
 *
 *   - `rows`  — append-only graph row list, replaced on graphNonce.
 *   - `edgeStates` — incremental per-row edge dict (port of GK's
 *     `getFinalEdgeStateForGraphAndRow` pipeline).
 *   - `hostingService` — drives avatar URL resolution (github CDN vs
 *     gravatar).
 *
 * Smart Branch Visibility is applied here too: when the toggle is on,
 * the backend resolver returns the 5-ref allowlist and we maintain its
 * complement against `rows()` in `hiddenBySmartFilter` so RefPills can
 * filter with O(1) lookups.
 */
export function useGraphData(repoPath: Accessor<string>) {
  const [rows, setRows] = createSignal<GraphRow[]>([]);
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

  // (Re-)stream the commit graph whenever the repo path or graphNonce changes.
  createEffect(() => {
    const path = repoPath();
    graphNonce();
    setRows([]);
    setLoading(true);
    setError(undefined);
    const handle = streamGraph(
      path,
      (batch) => {
        setRows((prev) => prev.concat(batch));
      },
      {
        onPinned: (sha) => setPinnedSha(sha ?? undefined),
      },
    );
    handle.promise
      .then(() => setLoading(false))
      .catch((e) => {
        setLoading(false);
        setError(String(e));
      });
    onCleanup(() => handle.stop());
  });

  // Smart Branch Visibility — port of GK's `SmartBranchesService`. The
  // backend computes the deterministic 5-ref allowlist via `smartVisibleRefs`;
  // we maintain the *complement* against `rows()` so RefPills can hide the
  // pills with O(1) lookups. The resource re-fires on repo / toggle / refs
  // changes (graphNonce bumps on every refresh that may move HEAD or refs).
  // Detached HEAD: backend returns `[]`; we clear the filter without flagging
  // an error (chajá deviation from GK's silent no-op — explicit cleanup).
  const [smartAllowed] = createResource(
    () => {
      const path = repoPath();
      const enabled = smartBranchesEnabled();
      // Track graphNonce so a refresh re-runs the resolver.
      void graphNonce();
      return enabled ? path : null;
    },
    async (path: string) => smartVisibleRefs(path),
  );

  createEffect(() => {
    if (!smartBranchesEnabled()) {
      setHiddenBySmartFilter(new Set());
      return;
    }
    const allowed = smartAllowed();
    if (!allowed || allowed.length === 0) {
      // Detached HEAD or unborn HEAD — backend returned an empty allowlist.
      // Do not apply the filter; matches GK's no-op for these cases.
      setHiddenBySmartFilter(new Set());
      return;
    }
    const allowedKeys = new Set<string>();
    for (const fullName of allowed) {
      if (fullName.startsWith("refs/heads/")) {
        const short = fullName.slice("refs/heads/".length);
        // Backend doesn't know whether a ref is the active HEAD or a plain
        // branch in chajá's RefTag taxonomy — accept either kind.
        allowedKeys.add(`Head/${short}`);
        allowedKeys.add(`Branch/${short}`);
      } else if (fullName.startsWith("refs/remotes/")) {
        const short = fullName.slice("refs/remotes/".length);
        allowedKeys.add(`RemoteBranch/${short}`);
      }
    }
    const hidden = new Set<string>();
    for (const row of rows()) {
      for (const ref of row.refs) {
        // Tags pass through Smart Branch Visibility — GK's `includeRef`
        // emits only branches and remotes, so tags are never in `allowed`,
        // but Smart Branches is not meant to hide them either.
        if (ref.kind === "Tag") continue;
        const key = `${ref.kind}/${ref.name}`;
        if (!allowedKeys.has(key)) hidden.add(key);
      }
    }
    setHiddenBySmartFilter(hidden);
  });

  // Detect the hosting-service tag once per repo path change. One-shot
  // query — the remote doesn't change while the graph is being rendered.
  createEffect(() => {
    const path = repoPath();
    setHostingService("unknown");
    getHostingService(path)
      .then(setHostingService)
      .catch(() => setHostingService("unknown"));
  });

  /**
   * Per-row edges dict — literal port of GitKraken's
   * `getFinalEdgeStateForGraphAndRow` pipeline. Each row gets a
   * `Map<column, {starting?, passThrough?, ending?}>` that the renderer
   * iterates to dispatch one of three drawing primitives per column.
   *
   * Incremental (#141): the builder closure caches the running result
   * array + last `prev` Map. Each `rows()` change only processes the
   * delta beyond the previous length — turns the per-batch O(N) full
   * recompute into O(batch_size), preventing O(N²) total on large
   * streams that bricked the event loop.
   *
   * Backed by a `{ equals: false }` signal because the incremental
   * builder mutates a stable result array in place, so reference
   * equality alone wouldn't fire downstream updates. The effect runs
   * on every `rows()` change and pushes the new (same-ref) array.
   */
  const incrementalBuilder = createIncrementalEdgeStates();
  const [edgeStates, setEdgeStates] = createSignal(incrementalBuilder([]), {
    equals: false,
  });
  createEffect(() => {
    setEdgeStates(incrementalBuilder(rows()));
  });

  return {
    rows,
    loading,
    error,
    hostingService,
    edgeStates,
  };
}
