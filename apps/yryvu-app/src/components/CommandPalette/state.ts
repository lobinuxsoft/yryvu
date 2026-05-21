// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import {
  buildSearchIndex,
  searchRepo,
  type IndexCounts,
  type SearchHit,
  type SearchMode,
} from "../../ipc";
import { notify } from "../Notifications";
import { repoPath, setInspectorMode, setSelection } from "../../state";

const MODES: SearchMode[] = ["commits", "files", "branches", "tags", "stashes"];

const [open, setOpen] = createSignal(false);
const [mode, setMode] = createSignal<SearchMode>("commits");
const [query, setQuery] = createSignal("");
const [hits, setHits] = createSignal<SearchHit[]>([]);
const [activeIdx, setActiveIdx] = createSignal(0);
const [counts, setCounts] = createSignal<IndexCounts>({
  commits: 0,
  files: 0,
  branches: 0,
  tags: 0,
  stashes: 0,
});
const [busy, setBusy] = createSignal(false);
const [error, setError] = createSignal<string | null>(null);

let searchToken = 0;

async function rebuildIndex() {
  const path = repoPath();
  if (!path) return;
  setBusy(true);
  try {
    const c = await buildSearchIndex(path);
    setCounts(c);
  } catch (e) {
    setError(`${e}`);
  } finally {
    setBusy(false);
  }
}

async function runSearch() {
  const path = repoPath();
  if (!path) return;
  const myToken = ++searchToken;
  try {
    const results = await searchRepo(path, mode(), query());
    // Drop stale responses.
    if (myToken !== searchToken) return;
    setHits(results);
    setActiveIdx(0);
  } catch (e) {
    if (myToken !== searchToken) return;
    setError(`${e}`);
  }
}

async function openPalette() {
  const path = repoPath();
  if (!path) {
    notify.info("Open a repository first", { category: "branch" });
    return;
  }
  setOpen(true);
  setQuery("");
  setActiveIdx(0);
  setError(null);
  await rebuildIndex();
  await runSearch();
}

function close() {
  setOpen(false);
  setQuery("");
  setHits([]);
  setError(null);
}

function setModeAndRefresh(m: SearchMode) {
  setMode(m);
  setActiveIdx(0);
  void runSearch();
}

function cycleMode(direction: 1 | -1) {
  const cur = MODES.indexOf(mode());
  const next = (cur + direction + MODES.length) % MODES.length;
  setModeAndRefresh(MODES[next]);
}

function moveSelection(delta: 1 | -1) {
  const total = hits().length;
  if (total === 0) return;
  setActiveIdx((i) => (i + delta + total) % total);
}

function setQueryAndSearch(q: string) {
  setQuery(q);
  void runSearch();
}

async function activate(hitOverride?: SearchHit) {
  const hit = hitOverride ?? hits()[activeIdx()];
  if (!hit) return;
  const path = repoPath();
  if (!path) return;
  try {
    await dispatchAction(hit, path);
  } catch (e) {
    setError(`${e}`);
    return;
  }
  close();
}

async function dispatchAction(hit: SearchHit, path: string) {
  switch (hit.mode) {
    case "commits": {
      // hit.label is the commit summary; we stored the short SHA in the
      // sublabel, but the index keeps full oids — re-derive via the
      // sublabel which is "shortsha · author".
      const short = hit.sublabel.split(" · ")[0];
      // Best-effort: select by short SHA; the graph resolver expands.
      setSelection([short], true);
      setInspectorMode("details");
      return;
    }
    case "branches": {
      const { checkoutBranch } = await import("../../ipc");
      try {
        await checkoutBranch(path, hit.label);
        notify.success("Checked out branch", { message: hit.label, category: "branch" });
      } catch (e) {
        notify.error("Checkout failed", { message: String(e), category: "branch" });
      }
      return;
    }
    case "tags": {
      const { checkoutCommit } = await import("../../ipc");
      try {
        await checkoutCommit(path, hit.sublabel);
        notify.info("Checked out tag (detached HEAD)", {
          message: hit.label,
          category: "branch",
        });
      } catch (e) {
        notify.error("Checkout failed", { message: String(e), category: "branch" });
      }
      return;
    }
    case "files": {
      void navigator.clipboard.writeText(hit.label);
      notify.info("File path copied", { message: hit.label, category: "branch" });
      return;
    }
    case "stashes": {
      void navigator.clipboard.writeText(hit.sublabel);
      notify.info("Stash ref copied", { message: hit.sublabel, category: "branch" });
      return;
    }
  }
}

export const commandPalette = {
  open,
  mode,
  query,
  hits,
  activeIdx,
  counts,
  busy,
  error,
  setQueryAndSearch,
  setMode: setModeAndRefresh,
  cycleMode,
  moveSelection,
  activate,
  MODES,
};

export function openCommandPalette() {
  void openPalette();
}

export function closeCommandPalette() {
  close();
}
