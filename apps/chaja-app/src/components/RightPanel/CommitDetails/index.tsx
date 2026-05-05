// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, createResource, Show } from "solid-js";

import { FileList } from "../../FileList";
import {
  getCombinedCommitDiff,
  getCommitDetails,
  getHostingService,
  type CombinedDiff,
  type CombinedDiffKind,
  type CommitDetail,
  type HostingService,
} from "../../../ipc";
import {
  openDiffTab,
  repoPath,
  selectedDiffFile,
  selectedShas,
  setSelectedCommit,
  workdirSelected,
} from "../../../state";
import { AuthorBlock } from "./AuthorBlock";
import { CommitDiffSection } from "./CommitDiffSection";
import { HeaderBlock } from "./HeaderBlock";
import { MessageBlock } from "./MessageBlock";
import { MultiSelectHeader } from "./MultiSelectHeader";

/**
 * Right-panel commit inspector (issue #112; perf rewrite for #176).
 *
 * Selection-driven layout per `docs/research/gitkraken-right-panel/`.
 * The variant (`single` / `multi` / `wip-only` / `commit-vs-wip` /
 * `multi-vs-wip`) is **derived from frontend state** rather than from
 * the backend payload — that way the header / chrome render the moment
 * the selection changes, without waiting for the diff IPC. The combined
 * diff resource still drives chips counts + file list contents, but its
 * loading state surfaces as a spinner over the chips and a skeleton row
 * band over the file list, matching GitKraken's `diffCalcInProgress`
 * pattern.
 *
 * Single-commit metadata (`getCommitDetails`) is a small IPC; we still
 * gate the HeaderBlock/MessageBlock/AuthorBlock on it. The expensive
 * round-trip is `getCombinedCommitDiff` — that's the one we render
 * around, not through.
 */
export function CommitDetails() {
  /** True iff exactly one committed row is selected without the WIP. */
  const isSingle = createMemo(
    () => selectedShas().length === 1 && !workdirSelected(),
  );

  /**
   * Variant derived from selection alone — no dependency on the
   * combined-diff IPC. Lets `MultiSelectHeader` render instantly when
   * the user clicks (or modifies) the selection.
   */
  const variantKind = createMemo<CombinedDiffKind>(() => {
    const n = selectedShas().length;
    const w = workdirSelected();
    if (n === 0 && w) return "wip-only";
    if (n === 1 && !w) return "single";
    if (n === 1 && w) return "commit-vs-wip";
    if (n >= 2 && !w) return "multi";
    return "multi-vs-wip";
  });

  const detailsRequest = createMemo<[string, string] | undefined>(() => {
    const p = repoPath();
    const shas = selectedShas();
    if (!p || shas.length !== 1 || workdirSelected()) return undefined;
    return [p, shas[0]];
  });
  const [details] = createResource<CommitDetail | undefined, [string, string]>(
    detailsRequest,
    async ([p, s]) => await getCommitDetails(p, s),
  );

  const [hostingService] = createResource<HostingService, string>(
    () => repoPath(),
    async (p) => await getHostingService(p),
  );

  /**
   * Combined diff — drives stat chips counts + file list contents.
   * Loading surfaces as the chip-row spinner and the file-list skeleton;
   * the header is independent so the panel never goes blank waiting on
   * this resource (issue #176, eggscape regression).
   */
  const combinedRequest = createMemo<[string, string[], boolean] | undefined>(
    () => {
      const p = repoPath();
      const shas = selectedShas();
      const wip = workdirSelected();
      if (!p) return undefined;
      if (shas.length === 0 && !wip) return undefined;
      return [p, shas, wip];
    },
  );
  const [combined] = createResource<
    CombinedDiff | undefined,
    [string, string[], boolean]
  >(combinedRequest, async ([p, s, w]) => await getCombinedCommitDiff(p, s, w));

  const revKey = createMemo<string>(() => {
    const c = combined();
    if (!c) return `pending|${selectedShas().join(",")}|${workdirSelected() ? 1 : 0}`;
    return `${c.kind}|${c.shas.join(",")}|${c.include_workdir ? 1 : 0}`;
  });

  const activeFilePath = createMemo<string | undefined>(() => {
    const c = combined();
    if (!c || c.kind !== "single") return undefined;
    const sel = selectedDiffFile();
    if (!sel || sel.kind !== "commit" || sel.sha !== c.shas[0]) return undefined;
    return sel.path;
  });

  function handleFileSelect(path: string): void {
    const c = combined();
    if (!c) return;
    if (c.kind === "single") {
      openDiffTab(c.shas[0], path);
    }
    // Multi-select / WIP variants: clicking a file is a no-op for now.
    // Tracked as a follow-up to extend the diff-tab system with a
    // merged patch source.
  }

  return (
    <Show
      when={selectedShas().length > 0 || workdirSelected()}
      fallback={
        <p class="inspector__empty">Select a commit to see its details.</p>
      }
    >
      {/* Single-commit chrome — gated on the (cheap) details IPC. */}
      <Show when={isSingle()}>
        <Show
          when={details()}
          fallback={
            <Show when={details.loading}>
              <div class="inspector__status">Loading commit details…</div>
            </Show>
          }
        >
          {(d) => (
            <>
              <HeaderBlock
                sha={d().sha}
                shortSha={d().short_sha}
                parentShas={d().parent_shas}
                onSelectParent={(sha) => setSelectedCommit(sha)}
              />
              <MessageBlock summary={d().summary} body={d().body} />
              <AuthorBlock
                detail={d()}
                hostingService={hostingService() ?? "unknown"}
              />
            </>
          )}
        </Show>
        <Show when={details.error}>
          <div class="inspector__error">{String(details.error)}</div>
        </Show>
      </Show>

      {/* Multi / WIP / commit-vs-WIP / multi-vs-WIP — header derived
          from frontend state, renders synchronously on selection change. */}
      <Show when={!isSingle()}>
        <MultiSelectHeader
          kind={variantKind()}
          nCommits={selectedShas().length}
        />
      </Show>

      {/* Chips + file list — always rendered once a selection exists.
          The combined-diff loading flag drives the spinner / skeleton;
          stale chips dim during a refetch instead of disappearing. */}
      <CommitDiffSection
        files={combined()?.files ?? []}
        loading={combined.loading}
      />
      <Show when={combined.error}>
        <div class="inspector__error">{String(combined.error)}</div>
      </Show>
      <FileList
        repoId={repoPath() ?? ""}
        revKey={revKey()}
        listType="committed"
        files={combined()?.files ?? []}
        activeFilePath={activeFilePath()}
        onSelectFile={handleFileSelect}
        loading={combined.loading}
      />
    </Show>
  );
}
