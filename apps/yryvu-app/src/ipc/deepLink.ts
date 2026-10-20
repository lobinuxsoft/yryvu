// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/** Mirrors `yryvu_bridge::repo::deep_link::LinkTarget`. */
export type LinkTarget =
  | { kind: "remote" }
  | { kind: "branch"; name: string }
  | { kind: "commit"; name: string }
  | { kind: "tag"; name: string };

export interface ResolvedLink {
  link: { firstSha: string; url: string; target: LinkTarget };
  matches: string[];
}

export function buildRepoLink(
  repoPath: string,
  target: LinkTarget,
): Promise<string> {
  return invoke<string>("build_repo_link", { repoPath, target });
}

export function resolveRepoLink(
  url: string,
  candidates: string[],
): Promise<ResolvedLink> {
  return invoke<ResolvedLink>("resolve_repo_link", { url, candidates });
}

/** Link that launched the app, if any. Consumed on read. */
export function takePendingLink(): Promise<string | null> {
  return invoke<string | null>("take_pending_link");
}
