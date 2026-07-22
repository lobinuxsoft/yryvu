// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  on,
  Show,
} from "solid-js";

import {
  getCommitSignConfig,
  getHeadCommitMessage,
  type SignConfig,
  type WorkingTreeStatus,
} from "../../ipc";
import type { FileDiff } from "../../ipc/diff";
import {
  amendEnabled,
  commitDescription,
  commitMessage,
  headBranchName,
  openStagingDiffTab,
  pendingCommitOptionsExpanded,
  preferences,
  repoPath,
  selectedDiffFile,
  setAmendEnabled,
  setCommitDescription,
  setCommitMessage,
  setSignCommitEnabled,
  setStagedFilesCollapsed,
  setUnstagedFilesCollapsed,
  stagedFilesCollapsed,
  unstagedFilesCollapsed,
} from "../../state";
import {
  clampCommitRegionHeight,
  commitDetailPanelLayout,
  setCommitRegionHeight,
} from "../../state/detail-panel-layout";
import { type RowAction } from "../FileList";
import { FileListToolbar } from "../FileList/FileListToolbar";
import { IconTrash } from "../Icons";
import { ResizableEdge } from "../ResizableEdge";
import { Tooltip } from "../Tooltip";
import {
  collapseAllDirs,
  displayTree,
  expandAllDirs,
  hasAnyCollapsed,
} from "../FileList/store";
import {
  buildTreeFromPaths,
  collectDirPaths,
} from "../FileList/treeBuild";
import { CommitFileSection } from "./CommitFileSection";
import { CoAuthorPicker } from "./CoAuthorPicker";
import { CommitButton } from "./CommitButton";
import { CommitMessage } from "./CommitMessage";
import { commitButtonLabel } from "./commitLabels";
import { CommitOptionsBlock } from "./CommitOptionsBlock";
import { useCommitRegionHeight } from "./useCommitRegionHeight";
import { toFileDiff } from "./workingTreeRows";

export interface CommitPanelProps {
  status: WorkingTreeStatus | undefined;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onDiscard: (paths: string[]) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onDiscardAll: () => void;
  onBack: () => void;
  onCommit: () => void;
  onCommitAndPush: () => void;
}

const UNSTAGED_REV: string = "unstaged";
const STAGED_REV: string = "staged";

export function CommitPanel(props: CommitPanelProps) {
  const unstaged = () => props.status?.unstaged ?? [];
  const staged = () => props.status?.staged ?? [];

  // Signing-config preflight. Re-runs on repo change AND on
  // `signConfigNonce` bumps (triggered after in-app key generation so
  // the toggle flips from disabled → enabled without a reload).
  const [signConfigNonce, setSignConfigNonce] = createSignal(0);
  const [signConfig] = createResource<SignConfig | undefined, [string, number]>(
    () => [repoPath() ?? "", signConfigNonce()] as [string, number],
    async ([p]) => {
      if (!p) return undefined;
      try {
        return await getCommitSignConfig(p);
      } catch (e) {
        console.error("commit_sign_config failed", e);
        return undefined;
      }
    },
  );

  // Default the sign toggle from preferences once both the user pref
  // and the repo signing config are available. Honors the per-session
  // override after that (the user clicking the checkbox wins).
  createEffect(() => {
    const cfg = signConfig();
    const pref = preferences()?.gpg.signCommitsByDefault ?? false;
    if (cfg && cfg.key && pref) setSignCommitEnabled(true);
  });

  const stagedCount = () => staged().length;
  const canCommit = () =>
    (stagedCount() > 0 || amendEnabled()) &&
    commitMessage().trim().length > 0;
  const totalChanges = () => unstaged().length + staged().length;

  const repoId = () => repoPath() ?? "";

  const unstagedFiles = createMemo<FileDiff[]>(() =>
    unstaged().map(toFileDiff),
  );
  const stagedFiles = createMemo<FileDiff[]>(() => staged().map(toFileDiff));

  // Tree is rebuilt independently inside FileList for rendering; we recompute
  // here only to derive the dir-paths set the shared Expand/Collapse All
  // actions need (the toolbar lives outside FileList for working-tree view,
  // so it can't reach into the widget's internal memo). Cost: O(N) per side
  // per status refresh — negligible relative to the IPC round-trip.
  const unstagedDirPaths = createMemo(() =>
    collectDirPaths(buildTreeFromPaths(unstagedFiles())),
  );
  const stagedDirPaths = createMemo(() =>
    collectDirPaths(buildTreeFromPaths(stagedFiles())),
  );

  const isTree = () => displayTree(repoId());

  const {
    observePanel,
    height: regionHeight,
    minHeight: regionMin,
    maxHeight: regionMax,
  } = useCommitRegionHeight(pendingCommitOptionsExpanded);

  // Toggling Amend on pre-fills summary/description from HEAD; off clears
  // both. User edits in between are preserved — we only fire on the
  // toggle transition.
  createEffect(
    on(
      amendEnabled,
      async (enabled, prev) => {
        if (enabled === prev) return;
        if (enabled) {
          const p = repoPath();
          if (!p) return;
          try {
            const msg = await getHeadCommitMessage(p);
            const [subject, ...rest] = msg.split("\n\n");
            setCommitMessage(subject.trim());
            setCommitDescription(rest.join("\n\n").trim());
          } catch (err) {
            console.error("head_commit_message failed", err);
          }
        } else {
          setCommitMessage("");
          setCommitDescription("");
        }
      },
      { defer: true },
    ),
  );

  const submitLabel = () =>
    commitButtonLabel({
      stagedCount: stagedCount(),
      amending: amendEnabled(),
      hasMessage: commitMessage().trim().length > 0,
    });

  const activeFor = (
    side: "unstaged" | "staged",
  ): string | undefined => {
    const sel = selectedDiffFile();
    if (sel?.kind !== "staging" || sel.side !== side) return undefined;
    return sel.path;
  };

  const unstagedActions: RowAction[] = [
    {
      label: "Stage",
      onClick: (path) => props.onStage([path]),
    },
    {
      label: "Discard",
      variant: "danger",
      title: "Revert this file to HEAD — no undo",
      onClick: (path) => props.onDiscard([path]),
    },
  ];

  const stagedActions: RowAction[] = [
    {
      label: "Unstage",
      onClick: (path) => props.onUnstage([path]),
    },
  ];

  // Shared toolbar fires Expand/Collapse All for both sections at once so
  // the widget action surface stays single-source-of-truth across the
  // working-tree view. Tree/Flat mode and filter are already shared via the
  // per-repo persisted store.
  const onExpandAllSections = () => {
    expandAllDirs(repoId(), UNSTAGED_REV, isTree());
    expandAllDirs(repoId(), STAGED_REV, isTree());
  };
  const onCollapseAllSections = () => {
    collapseAllDirs(repoId(), UNSTAGED_REV, isTree(), unstagedDirPaths());
    collapseAllDirs(repoId(), STAGED_REV, isTree(), stagedDirPaths());
  };

  return (
    <div class="commit-panel" ref={observePanel}>
      <div class="commit-panel__header">
        <Tooltip text="Back to commit details">
          <button
            class="commit-panel__back"
            type="button"
            onClick={() => props.onBack()}
          >
            ← Back
          </button>
        </Tooltip>
        {/* GK gates its discard-all on `numberOfChanges === 0` (bundle
            3475350) — a clean tree offers nothing to discard. The
            per-section "Discard All Changes" text button stays; this is
            the panel-wide affordance GK puts in the header. */}
        <Show when={totalChanges() > 0}>
          <Tooltip text="Discard all changes">
            <button
              class="commit-panel__discard-all"
              type="button"
              aria-label="Discard all changes"
              onClick={() => props.onDiscardAll()}
            >
              <IconTrash width={13} height={13} />
            </button>
          </Tooltip>
        </Show>
        <span class="commit-panel__heading">
          {totalChanges()} file change{totalChanges() === 1 ? "" : "s"}{" "}
          <Show when={headBranchName()} fallback="in working directory">
            {/* GK tints this pill with the head ref's graph-column colour
                (`getClassesForBranchLabels`, bundle 3478440). yryvu already
                discarded lane tinting for ref pills as a deliberate
                deviation (see ref-pills.css) — the pill reuses the same
                HEAD variant the graph uses so the two agree. */}
            on{" "}
            <span class="ref-pill ref-pill--head commit-panel__heading-branch">
              {headBranchName()}
            </span>
          </Show>
        </span>
      </div>

      <Show when={totalChanges() === 0}>
        <p class="inspector__empty">Working tree is clean.</p>
      </Show>

      <Show when={totalChanges() > 0}>
        <FileListToolbar
          repoId={repoId()}
          allExpanded={
            !hasAnyCollapsed(repoId(), UNSTAGED_REV, isTree()) &&
            !hasAnyCollapsed(repoId(), STAGED_REV, isTree())
          }
          onExpandAll={onExpandAllSections}
          onCollapseAll={onCollapseAllSections}
        />
      </Show>

      {/* GK's staging-scroll: owns the space between the toolbar and the
          commit form. Each expanded section takes a fixed 50% share and
          its FileList scrolls independently — the panel itself never
          scrolls (#430). */}
      <div class="commit-panel__sections">
        <CommitFileSection
          side="unstaged"
          title="Unstaged Files"
          bulkLabel="Stage All Changes"
          secondaryBulkLabel="Discard All Changes"
          collapsed={unstagedFilesCollapsed()}
          onToggleCollapsed={() => setUnstagedFilesCollapsed((v) => !v)}
          onBulk={() => props.onStageAll()}
          onSecondaryBulk={() => props.onDiscardAll()}
          repoId={repoId()}
          files={unstagedFiles()}
          activeFilePath={activeFor("unstaged")}
          onSelectFile={(p) => openStagingDiffTab("unstaged", p)}
          rowActions={unstagedActions}
        />

        <CommitFileSection
          side="staged"
          title="Staged Files"
          bulkLabel="Unstage All Changes"
          collapsed={stagedFilesCollapsed()}
          onToggleCollapsed={() => setStagedFilesCollapsed((v) => !v)}
          onBulk={() => props.onUnstageAll()}
          repoId={repoId()}
          files={stagedFiles()}
          activeFilePath={activeFor("staged")}
          onSelectFile={(p) => openStagingDiffTab("staged", p)}
          rowActions={stagedActions}
        />
      </div>

      <section
        class="commit-panel__commit-form"
        style={{ height: `${regionHeight()}px` }}
      >
        {/* GK's `<Resizable resizeEdge="top">` on the commit region
            (bundle 270020) — the one draggable boundary in this panel.
            The Unstaged/Staged split above stays fixed at 50/50 (#430). */}
        <ResizableEdge
          edge="top"
          size={regionHeight}
          setSize={setCommitRegionHeight}
          clamp={(h, max) => clampCommitRegionHeight(h, max, regionMin())}
          viewportMaxSize={regionMax}
          commit={commitDetailPanelLayout}
          ariaLabel="Resize commit region"
        />
        <header class="commit-panel__commit-form__header">
          <span>Commit</span>
          <label class="commit-panel__amend">
            <input
              type="checkbox"
              checked={amendEnabled()}
              onInput={(e) => setAmendEnabled(e.currentTarget.checked)}
            />
            <span>Amend previous commit</span>
          </label>
        </header>

        {/* Middle scrolls under pressure; header + Commit button stay
            pinned (GK parity — button-row is never scrolled away). */}
        <div class="commit-panel__commit-form__scroll">
          <CommitMessage
            summary={commitMessage()}
            description={commitDescription()}
            onSummaryChange={setCommitMessage}
            onDescriptionChange={setCommitDescription}
          />

          <CoAuthorPicker
            repoPath={repoPath() ?? ""}
            description={commitDescription()}
            onChange={setCommitDescription}
          />

          <CommitOptionsBlock
            signConfig={signConfig()}
            repoPath={repoPath() ?? null}
            defaultName={signConfig()?.userName ?? ""}
            defaultEmail={signConfig()?.userEmail ?? ""}
            onKeyGenerated={() => setSignConfigNonce((n) => n + 1)}
          />
        </div>

        <CommitButton
          label={submitLabel()}
          disabled={!canCommit()}
          mode={amendEnabled() ? "amend" : "commit"}
          onCommit={() => props.onCommit()}
          onCommitAndPush={() => props.onCommitAndPush()}
        />
      </section>
    </div>
  );
}
