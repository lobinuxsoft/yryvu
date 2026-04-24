// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, createResource, Show } from "solid-js";

import { FileList } from "../../FileList";
import {
  getCommitDetails,
  getCommitDiff,
  getHostingService,
  type CommitDetail,
  type CommitDiff,
  type HostingService,
} from "../../../ipc";
import {
  openDiffTab,
  repoPath,
  selectedCommit,
  selectedDiffFile,
  setSelectedCommit,
} from "../../../state";
import { AuthorBlock } from "./AuthorBlock";
import { HeaderBlock } from "./HeaderBlock";
import { MessageBlock } from "./MessageBlock";

/**
 * Right-panel commit inspector (issue #112, Fase 1).
 *
 * Layout top-to-bottom per `docs/research/gitkraken-right-panel/`:
 *  1. HeaderBlock — 6-char SHA with copy button + parent pills (`02-commit-header.md`).
 *  2. MessageBlock — subject + body with emojify-only transform (`03-message-section.md`).
 *  3. AuthorBlock — author / committer (with the double-guard) / co-authors (`04-author-committer-block.md`).
 *  4. Diff summary + changed files (Fase 2/3 — preserved from the pre-#112 panel).
 *
 * Two separate resources back the view: `details` (metadata) and `diff`
 * (file changes). The two commands are cheap; keeping them split means
 * a slow diff compute doesn't delay the message/author chrome.
 */
export function CommitDetails() {
  const [details] = createResource<CommitDetail | undefined, [string, string]>(
    () => {
      const p = repoPath();
      const s = selectedCommit();
      return p && s ? ([p, s] as [string, string]) : undefined;
    },
    async ([p, s]) => await getCommitDetails(p, s),
  );

  const [diff] = createResource<CommitDiff | undefined, [string, string]>(
    () => {
      const p = repoPath();
      const s = selectedCommit();
      return p && s ? ([p, s] as [string, string]) : undefined;
    },
    async ([p, s]) => await getCommitDiff(p, s),
  );

  const [hostingService] = createResource<HostingService, string>(
    () => repoPath(),
    async (p) => await getHostingService(p),
  );

  // Active file accessor — a createMemo so Solid's JSX attribute wrapping
  // stays reactive. Passing an IIFE here (`activeFilePath={(() => {...})()}`)
  // evaluates once at mount and never updates, which breaks selection
  // highlight.
  const activeFilePath = createMemo<string | undefined>(() => {
    const sel = selectedDiffFile();
    const d = diff();
    if (!d || !sel || sel.kind !== "commit" || sel.sha !== d.sha) return undefined;
    return sel.path;
  });

  const totals = () => {
    const d = diff();
    if (!d) return { add: 0, del: 0, files: 0 };
    return d.files.reduce(
      (acc, f) => ({
        add: acc.add + f.additions,
        del: acc.del + f.deletions,
        files: acc.files + 1,
      }),
      { add: 0, del: 0, files: 0 },
    );
  };

  return (
    <Show
      when={selectedCommit()}
      fallback={
        <p class="inspector__empty">Select a commit to see its details.</p>
      }
    >
      <Show when={details.loading && !details()}>
        <div class="inspector__status">Loading commit details…</div>
      </Show>
      <Show when={details.error}>
        <div class="inspector__error">{String(details.error)}</div>
      </Show>

      <Show when={details()}>
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

      <Show when={diff.loading && !diff()}>
        <div class="inspector__status">Loading changed files…</div>
      </Show>
      <Show when={diff.error}>
        <div class="inspector__error">{String(diff.error)}</div>
      </Show>

      <Show when={diff() && !diff.loading && !diff.error}>
        <div class="inspector__summary">
          <span>
            {totals().files} file{totals().files === 1 ? "" : "s"} changed
          </span>
          <Show when={totals().add > 0 || totals().del > 0}>
            <span class="inspector__summary-stats">
              <Show when={totals().add > 0}>
                <span class="inspector__summary-stats--add">
                  +{totals().add}
                </span>
              </Show>
              <Show when={totals().del > 0}>
                <span class="inspector__summary-stats--del">
                  -{totals().del}
                </span>
              </Show>
            </span>
          </Show>
          <Show when={diff()!.parent_sha}>
            <span class="inspector__summary-parent">
              vs <code>{diff()!.parent_sha!.slice(0, 7)}</code>
            </span>
          </Show>
        </div>

        <FileList
          repoId={repoPath() ?? ""}
          revKey={diff()!.sha}
          listType="committed"
          files={diff()!.files}
          activeFilePath={activeFilePath()}
          onSelectFile={(path) => openDiffTab(diff()!.sha, path)}
        />
      </Show>
    </Show>
  );
}
