// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, createResource, Show } from "solid-js";

import { FileList } from "../../FileList";
import {
  getCombinedCommitDiff,
  getCommitDetails,
  getHostingService,
  type CombinedDiff,
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
 * Right-panel commit inspector (issue #112).
 *
 * Selection-driven layout per `docs/research/gitkraken-right-panel/`:
 *
 *   - **Single commit** (`selectedShas().length === 1 && !workdirSelected()`):
 *     full identity chrome — HeaderBlock (sha + parents) → MessageBlock
 *     (subject + body) → AuthorBlock (author + committer + co-authors) →
 *     CommitDiffSection chips → FileList.
 *
 *   - **Multi-commit / commit-vs-WIP / multi-vs-WIP / WIP-only**:
 *     MultiSelectHeader (one-line title summarising what's being diffed) →
 *     CommitDiffSection chips → FileList.
 *
 * The combined diff IPC drives every variant — `combined_commit_diff`
 * returns the merged file diff plus a `kind` tag so we don't re-derive the
 * variant on the frontend. Single-commit metadata still resolves through
 * `getCommitDetails` (commit message + author), which the multi variants
 * skip entirely.
 */
export function CommitDetails() {
  /**
   * Single-commit metadata — author, committer, message, parents.
   * Resolved only when exactly one committed row is selected and the WIP
   * is NOT part of the selection. The combined diff handles every other
   * variant on its own.
   */
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
   * Combined diff — merged file diff for the current selection. Drives the
   * stat chips, the file list, and the variant header.
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

  /**
   * Cache key for the FileList's per-revision ephemeral state (collapsed
   * dirs, forced-visible files). Each selection variant gets its own
   * keyspace so flipping between them doesn't leak collapsed dirs across
   * unrelated diffs.
   */
  const revKey = createMemo<string>(() => {
    const c = combined();
    if (!c) return "";
    return `${c.kind}|${c.shas.join(",")}|${c.include_workdir ? 1 : 0}`;
  });

  /**
   * Active file in the diff full-tab — only meaningful in single-commit
   * mode where we still drive the main view's diff. Multi-select / WIP
   * variants leave the file list as a selection-only widget for now;
   * routing the merged-diff into the main tab system needs its own
   * follow-up (new `selectedDiffFile` kind + IPC for per-file merged
   * patches).
   */
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
    // Tracked as a follow-up to extend the diff-tab system with a merged
    // patch source.
  }

  const isSingle = createMemo(() => combined()?.kind === "single");

  return (
    <Show
      when={selectedShas().length > 0 || workdirSelected()}
      fallback={
        <p class="inspector__empty">Select a commit to see its details.</p>
      }
    >
      {/* Single-commit chrome — guarded against `details()` being undefined
          while the resource is in flight. The `combined` resource fires in
          parallel so the chips/file list don't block on the metadata
          fetch. */}
      <Show when={isSingle() && details()}>
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
      <Show when={isSingle() && details.loading && !details()}>
        <div class="inspector__status">Loading commit details…</div>
      </Show>
      <Show when={isSingle() && details.error}>
        <div class="inspector__error">{String(details.error)}</div>
      </Show>

      {/* Multi / WIP / commit-vs-WIP / multi-vs-WIP — single-line header. */}
      <Show when={combined() && !isSingle()}>
        <MultiSelectHeader
          kind={combined()!.kind}
          nCommits={combined()!.n_commits}
        />
      </Show>

      <Show when={combined.loading && !combined()}>
        <div class="inspector__status">Loading changed files…</div>
      </Show>
      <Show when={combined.error}>
        <div class="inspector__error">{String(combined.error)}</div>
      </Show>

      <Show when={combined() && !combined.error}>
        <CommitDiffSection
          files={combined()!.files}
          loading={combined.loading}
        />
        <FileList
          repoId={repoPath() ?? ""}
          revKey={revKey()}
          listType="committed"
          files={combined()!.files}
          activeFilePath={activeFilePath()}
          onSelectFile={handleFileSelect}
        />
      </Show>
    </Show>
  );
}
