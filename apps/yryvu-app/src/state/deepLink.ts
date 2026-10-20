// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import { listBranches, listTags } from "../ipc";
import {
  buildRepoLink,
  resolveRepoLink,
  type LinkTarget,
} from "../ipc/deepLink";
import { notify } from "../components/Notifications";
import { openRepoInAnotherTab } from "../tabs/ops";
import { tabs } from "../tabs/state";
import { navigateToRef } from "./refNavigation";
import { loadRecentRepos } from "./recent-repos";
import { setRepoPath } from "./repo";

const PENDING_TTL_MS = 15_000;

const [pendingSha, setPendingSha] = createSignal<string | undefined>();
export const pendingDeepLinkSha = pendingSha;

let expiry: ReturnType<typeof setTimeout> | undefined;

/// Select `sha` once the graph has streamed it in. The graph clears this
/// itself; the timer drops a sha that never arrives.
function selectWhenLoaded(sha: string): void {
  clearTimeout(expiry);
  setPendingSha(sha);
  expiry = setTimeout(() => setPendingSha(undefined), PENDING_TTL_MS);
}

export function consumeDeepLinkSha(sha: string): void {
  clearTimeout(expiry);
  setPendingSha(undefined);
  navigateToRef(sha);
}

async function targetSha(
  repo: string,
  target: LinkTarget,
): Promise<string | undefined> {
  switch (target.kind) {
    case "commit":
      return target.name;
    case "branch":
      return (await listBranches(repo)).find((b) => b.name === target.name)
        ?.tip_sha;
    case "tag":
      return (await listTags(repo)).find((t) => t.name === target.name)
        ?.target_sha;
    case "remote":
      return undefined;
  }
}

export async function copyDeepLink(
  repo: string,
  target: LinkTarget,
): Promise<void> {
  try {
    const link = await buildRepoLink(repo, target);
    await navigator.clipboard.writeText(link);
    notify.info("Deep link copied", { message: link, category: "repoObject" });
  } catch (e) {
    notify.error("Could not copy deep link", { message: String(e) });
  }
}

/// Open the repo a `yryvu://repolink` points at and select its target.
export async function handleDeepLink(url: string): Promise<void> {
  try {
    const open = tabs().flatMap((t) => (t.type === "REPO" ? [t.repoPath] : []));
    const recent = loadRecentRepos().map((r) => r.path);
    const { link, matches } = await resolveRepoLink(url, [
      ...new Set([...open, ...recent]),
    ]);
    const repo = matches[0];
    if (!repo) {
      notify.error("Repository not found", {
        message: `No open or recent repository has the remote ${link.url}`,
      });
      return;
    }
    setRepoPath(repo);
    await openRepoInAnotherTab(repo);
    const sha = await targetSha(repo, link.target);
    if (sha) selectWhenLoaded(sha);
    else if (link.target.kind !== "remote") {
      notify.error("Link target not found", {
        message: `${link.target.kind} ${link.target.name} is not in ${repo}`,
      });
    }
  } catch (e) {
    notify.error("Invalid link", { message: String(e) });
  }
}
