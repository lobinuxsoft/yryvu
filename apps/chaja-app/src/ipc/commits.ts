// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function checkoutCommit(repoPath: string, sha: string): Promise<void> {
  return invoke<void>("checkout_commit", { repoPath, sha });
}

export type ResetMode = "soft" | "mixed" | "hard";

export function resetToCommit(
  repoPath: string,
  sha: string,
  mode: ResetMode,
): Promise<void> {
  return invoke<void>("reset_to_commit", { repoPath, sha, mode });
}

export function cherryPickCommit(repoPath: string, sha: string): Promise<void> {
  return invoke<void>("cherry_pick_commit", { repoPath, sha });
}

export function revertCommit(repoPath: string, sha: string): Promise<void> {
  return invoke<void>("revert_commit", { repoPath, sha });
}

export function formatPatch(
  repoPath: string,
  sha: string,
  outDir: string,
): Promise<string> {
  return invoke<string>("format_patch", { repoPath, sha, outDir });
}

/**
 * Provider tags recognised by the backend's `detect_hosting_service`.
 * Drives provider-native avatar resolution — notably the GitHub CDN
 * endpoint `avatars.githubusercontent.com/u/e?email=…` which resolves an
 * avatar from an email with no API auth (bundle offset 1508073 in
 * GitKraken's app bundle). Anything the backend can't confidently
 * classify collapses to `"unknown"` and the frontend falls back to
 * Gravatar.
 */
export type HostingService =
  | "github"
  | "gitlab"
  | "bitbucket"
  | "gitea"
  | "unknown";

export function getHostingService(repoPath: string): Promise<HostingService> {
  return invoke<HostingService>("get_hosting_service", { repoPath });
}

export interface RefTag {
  name: string;
  kind: "Branch" | "RemoteBranch" | "Tag" | "Head";
}

/**
 * Mirror of the Rust `graph_core::ChildRefs` — refs reachable from this
 * commit's strict descendants, bucketed by kind. Populated via the
 * `populate_child_refs` pass in `layout_commits`. Rust-side `HashSet<String>`
 * serializes as a JSON array, so these land as `string[]` here.
 */
export interface ChildRefs {
  heads: string[];
  remotes: string[];
  tags: string[];
}

export interface GraphRow {
  sha: string;
  short_sha: string;
  summary: string;
  /**
   * Commit message body — everything after the subject line with leading
   * blank-line separators trimmed. Empty string when the commit has only a
   * subject. Raw content (trailers included) to match GitKraken's render,
   * which emojify-only transforms the body and parses trailers client-side
   * for the co-authors list.
   */
  body: string;
  /**
   * Author's display name only (no email). For the old `"Name <email>"` form
   * the backend used to send, compose via `${author_name} <${author_email}>`.
   */
  author_name: string;
  /** Author email, lowercase-trimmed by the backend via gix. */
  author_email: string;
  /**
   * Two-character initials fallback for the avatar badge, pre-computed in
   * `graph-core::author_initials`. Uppercased.
   */
  author_initials: string;
  /**
   * Lowercase hex MD5 of the trimmed-lowercased email — the Gravatar URL
   * fragment. Compose the full URL via
   * `https://gravatar.com/avatar/${gravatar_hash}?s=36&d=404`. `d=404` so
   * Gravatar returns 404 (instead of its default placeholder) when no
   * avatar is registered, letting the frontend fall back cleanly.
   */
  gravatar_hash: string;
  author_date: number;
  /**
   * Committer identity. Populated when the commit has committer metadata
   * (virtually always); `null` only on malformed / ancient commits the gix
   * backend couldn't decode. The right-panel commit block renders the
   * committer row only when both conditions hold: `committer_*` is non-null
   * AND differs from `author_name`/`author_email`. Mirrors the GitKraken
   * bundle guard `!committerInfo || (email===author && name===author)`.
   */
  committer_name: string | null;
  committer_email: string | null;
  committer_date: number | null;
  /**
   * Pre-computed initials + gravatar hash for the committer, same shape as
   * the author equivalents. `null` when committer metadata is absent.
   * Identical to the author values when committer matches author — frontend
   * still renders at most one block per the guard above.
   */
  committer_initials: string | null;
  committer_gravatar_hash: string | null;
  lane: number;
  parent_lanes: number[];
  parent_shas: string[];
  color_idx: number;
  refs: RefTag[];
  is_merge: boolean;
  child_refs: ChildRefs;
  /**
   * Lane indices carrying a visual edge through this row (sorted ascending,
   * deduplicated). Populated in graph-core via pre+post snapshots of
   * `columns_used` around each `place()` call. Consumed by the per-row
   * renderer (#81) to emit a vertical pipe segment per listed lane confined
   * to the row's height.
   */
  active_lanes: number[];
}

interface GraphBatch {
  rows: GraphRow[];
  done: boolean;
}

export interface StreamHandle {
  stop: () => void;
  promise: Promise<void>;
}

/**
 * Invokes `stream_graph` on the Rust side and emits row batches via `onBatch`.
 * Resolves when the Rust task signals `done`.
 */
export function streamGraph(
  repoPath: string,
  onBatch: (rows: GraphRow[]) => void,
  batchSize = 100,
): StreamHandle {
  let unlisten: UnlistenFn | undefined;
  let resolve!: () => void;
  let reject!: (err: unknown) => void;

  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  (async () => {
    try {
      unlisten = await listen<GraphBatch>("graph:batch", (e) => {
        if (e.payload.rows.length > 0) onBatch(e.payload.rows);
        if (e.payload.done) {
          unlisten?.();
          resolve();
        }
      });
      await invoke("stream_graph", { repoPath, batchSize });
    } catch (err) {
      unlisten?.();
      reject(err);
    }
  })();

  return {
    stop: () => unlisten?.(),
    promise,
  };
}
