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
  markAppActivity,
  setHiddenBySmartFilter,
  setPinnedSha,
  smartBranchesEnabled,
} from "../../state";
import { createIncrementalEdgeStates } from "./edgeStates";

/// Initial walk depth. A large repo lays out these newest commits fast
/// instead of paying for the whole history up front; older commits load on
/// demand (see `loadMore`). Sized to comfortably fill a tall viewport with
/// headroom so the common case never needs a second fetch.
const DEFAULT_GRAPH_LIMIT = 1000;
/// How many more commits each `loadMore` pulls in.
const LOAD_MORE_STEP = 1000;

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
  /// Newest-first walk cap. Only ever grows (via `loadMore`); never reset on
  /// repo switch or refresh, so an expanded view survives a commit landing.
  const [limit, setLimit] = createSignal(DEFAULT_GRAPH_LIMIT);
  /// True while a `loadMore` re-stream is in flight — gates the button and
  /// the scroll trigger so we never fire overlapping extends.
  const [loadingMore, setLoadingMore] = createSignal(false);
  /// The last stream filled the cap, so older commits probably exist.
  const [hasMore, setHasMore] = createSignal(false);
  /**
   * Provider tag for the repo's primary remote. Re-queried whenever the
   * repo path changes. Drives avatar URL resolution per row — `"github"`
   * routes through the GitHub CDN's email endpoint (no API auth needed),
   * anything else falls back to Gravatar.
   */
  const [hostingService, setHostingService] =
    createSignal<HostingService>("unknown");

  // (Re-)stream the commit graph. Two triggers, two behaviours:
  //   - reload (repo path or graphNonce changed): clear and stream
  //     progressively so the skeleton gives way to rows as they arrive.
  //   - extend (limit grew via loadMore): keep the current rows on screen and
  //     buffer the larger walk, swapping it in one shot when it completes — no
  //     empty flash, no scroll jump, and lanes recompute correctly against the
  //     full set. `lastReloadKey` tells the two triggers apart.
  let lastReloadKey = "";
  createEffect(() => {
    const path = repoPath();
    const nonce = graphNonce();
    const lim = limit();
    const reloadKey = `${path}|${nonce}`;
    const isReload = reloadKey !== lastReloadKey;
    lastReloadKey = reloadKey;

    if (isReload) {
      setRows([]);
      setLoading(true);
    } else {
      setLoadingMore(true);
    }
    setError(undefined);

    // The revwalk reads across `.git` — arm the suppression window so its
    // atime churn doesn't loop back through the watcher.
    markAppActivity();

    const buffer: GraphRow[] = [];
    const handle = streamGraph(
      path,
      (batch) => {
        buffer.push(...batch);
        if (isReload) setRows((prev) => prev.concat(batch));
      },
      {
        limit: lim,
        onPinned: (sha) => setPinnedSha(sha ?? undefined),
      },
    );
    handle.promise
      .then(() => {
        if (!isReload) setRows(buffer);
        // Filled the cap → older commits probably remain.
        setHasMore(buffer.length >= lim);
        setLoading(false);
        setLoadingMore(false);
        // Re-arm after the reads complete so the trailing echo is covered.
        markAppActivity();
      })
      .catch((e) => {
        setLoading(false);
        setLoadingMore(false);
        setError(String(e));
      });
    onCleanup(() => handle.stop());
  });

  /// Pull in the next page of older commits. No-op while a stream is in
  /// flight or when the last walk didn't fill the cap (nothing more to load).
  const loadMore = () => {
    if (loading() || loadingMore() || !hasMore()) return;
    setLimit((l) => l + LOAD_MORE_STEP);
  };

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
    loadingMore,
    hasMore,
    loadMore,
    error,
    hostingService,
    edgeStates,
  };
}
