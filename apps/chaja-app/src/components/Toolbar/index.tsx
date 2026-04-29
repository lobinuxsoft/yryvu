// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createMemo,
  createResource,
  createSignal,
  type JSX,
  Show,
} from "solid-js";

import {
  fetchPrune,
  forcePull,
  listBranches,
  pull,
  push,
  stashCount,
  stashPop,
  stashPush,
  type BranchInfo,
} from "../../ipc";
import { runRedo, runUndo } from "../../undoOps";
import { useBranchOps } from "../../branchOps";
import {
  branchesNonce,
  dirtyFileCount,
  openPreferences,
  pullType,
  refreshBranches,
  refreshGraph,
  refreshWorkingTree,
  repoPath,
  setPullType,
  undoRedoState,
  workingTreeNonce,
  type PullType,
} from "../../state";
import { Bell, dismissToast, notify } from "../Notifications";
import { BranchSwitcher } from "./BranchSwitcher";
import { ConfirmDialog } from "./ConfirmDialog";
import { RepoSwitcher } from "./RepoSwitcher";
import { SplitButton, type SplitButtonOption } from "./SplitButton";
import { UpstreamIndicator } from "./UpstreamIndicator";
import {
  IconArrowDown,
  IconArrowUp,
  IconBranch,
  IconGear,
  IconRedo,
  IconSearch,
  IconStashIn,
  IconStashOut,
  IconTerminal,
  IconUndo,
} from "../Icons";

export interface ToolbarProps {
  onOpenRepo: () => void;
}

type ConfirmKind = "force-pull" | "force-push";

const PULL_HEADER = "Choose your pull strategy";
const PUSH_HEADER = "Push options";

export function Toolbar(props: ToolbarProps) {
  const ops = useBranchOps();
  const [pending, setPending] = createSignal<string | null>(null);
  const [confirm, setConfirm] = createSignal<ConfirmKind | null>(null);

  // Active branch info — drives UpstreamIndicator and ahead/behind-aware
  // disable states. Keyed on (repoPath, branchesNonce) so it re-runs
  // whenever the LeftSidebar refresh fires (push, pull, fetch, branch CRUD).
  const [branches] = createResource<BranchInfo[], [string, number]>(
    () => [repoPath() ?? "", branchesNonce()] as [string, number],
    async ([path]) => {
      if (!path) return [] as BranchInfo[];
      return await listBranches(path);
    },
  );

  const headBranch = createMemo<BranchInfo | undefined>(() =>
    branches()?.find((b) => b.is_head),
  );
  const aheadCount = () => headBranch()?.ahead ?? 0;
  const behindCount = () => headBranch()?.behind ?? 0;
  const upstreamShort = () => headBranch()?.upstream ?? undefined;
  const hasUpstream = () => upstreamShort() !== undefined;

  // Stash queue size — gates the Pop button so the user can't fire it
  // on an empty queue. Keyed on workingTreeNonce so a successful Stash
  // / Pop refetches without us doing anything else.
  const [stashCountResource] = createResource<number, [string, number]>(
    () => [repoPath() ?? "", workingTreeNonce()] as [string, number],
    async ([path]) => {
      if (!path) return 0;
      return await stashCount(path);
    },
  );
  const stashEntries = () => stashCountResource() ?? 0;

  function refreshAfterRemoteOp() {
    refreshGraph();
    refreshBranches();
  }


  async function withOp(
    label: string,
    successTitle: string,
    fn: () => Promise<string | void>,
  ): Promise<void> {
    const path = repoPath();
    if (!path) return;
    setPending(label);
    const loadingId = notify.loading(`${label}…`);
    try {
      const successMessage = await fn();
      dismissToast(loadingId);
      notify.success(
        successTitle,
        typeof successMessage === "string" ? { message: successMessage } : undefined,
      );
    } catch (err) {
      dismissToast(loadingId);
      notify.error(`${label} failed`, { message: String(err) });
    } finally {
      setPending(null);
    }
  }

  function pullStrategyMessage(
    result: Awaited<ReturnType<typeof pull>>,
  ): string {
    switch (result.kind) {
      case "already-up-to-date":
        return "Already up to date";
      case "fast-forward":
        return `Fast-forwarded to ${result.new_head.slice(0, 7)}`;
      case "merged":
        return `Merge commit ${result.new_head.slice(0, 7)}`;
      case "conflict":
        throw new Error(`Conflicts in ${result.paths.join(", ")}`);
    }
  }

  async function runPullMerge() {
    await withOp("Pull", "Pull complete", async () => {
      const result = await pull(repoPath()!, "fast-forward-or-merge");
      refreshAfterRemoteOp();
      return pullStrategyMessage(result);
    });
  }

  async function runPullFFOnly() {
    await withOp("Pull (FF only)", "Pull complete", async () => {
      const result = await pull(repoPath()!, "fast-forward-only");
      refreshAfterRemoteOp();
      return pullStrategyMessage(result);
    });
  }

  async function runFetchAll() {
    await withOp("Fetch all", "Fetched all remotes", async () => {
      await fetchPrune(repoPath()!);
      refreshAfterRemoteOp();
    });
  }

  async function runForcePull() {
    setConfirm(null);
    await withOp("Force pull", "Force-pulled (HEAD reset to upstream)", async () => {
      await forcePull(repoPath()!);
      refreshAfterRemoteOp();
      refreshWorkingTree();
    });
  }

  async function runPush() {
    await withOp("Push", "Push complete", async () => {
      await push(repoPath()!);
      refreshAfterRemoteOp();
    });
  }

  async function runForcePushWithLease() {
    setConfirm(null);
    await withOp("Force push (with lease)", "Force-pushed with lease", async () => {
      await push(repoPath()!, { forceWithLease: true });
      refreshAfterRemoteOp();
    });
  }

  function handlePullSelect(id: string) {
    switch (id as PullType) {
      case "fetch":
        return void runFetchAll();
      case "pull_merge":
        return void runPullMerge();
      case "pull_ff_only":
        return void runPullFFOnly();
      case "pull_rebase":
        return; // disabled — rebase primitive #11
      case "force_pull":
        return setConfirm("force-pull");
    }
  }

  function handlePushSelect(id: string) {
    if (id === "push") return void runPush();
    if (id === "force_push_lease") return setConfirm("force-push");
  }

  function onBranch() {
    if (!repoPath()) return;
    ops.openCreateDialog();
  }

  async function onStash() {
    await withOp("Stash", "Stashed working tree", async () => {
      await stashPush(repoPath()!);
      refreshWorkingTree();
      refreshAfterRemoteOp();
    });
  }

  async function onPop() {
    await withOp("Stash pop", "Stash applied", async () => {
      await stashPop(repoPath()!);
      refreshWorkingTree();
      refreshAfterRemoteOp();
    });
  }

  const hasRepo = () => repoPath() !== undefined && repoPath() !== "";
  const stashDisabled = () => !hasRepo() || dirtyFileCount() === 0;
  const opInFlight = () => pending() !== null;
  const pullDisabled = () => !hasRepo() || opInFlight();
  const pushDisabled = () => !hasRepo() || opInFlight();

  // Pull dropdown — order matches GitKraken (FETCH, MERGE, FF_ONLY,
  // REBASE) plus chajá's `force_pull` as the destructive 5th item.
  // `pull_rebase` stays disabled until the rebase primitive lands (#11).
  const pullOptions = (): SplitButtonOption[] => [
    { id: "fetch", label: "Fetch all" },
    {
      id: "pull_merge",
      label: "Pull (merge)",
      disabled: !hasUpstream(),
      tooltip: hasUpstream() ? undefined : "No upstream configured",
    },
    {
      id: "pull_ff_only",
      label: "Pull (FF only)",
      disabled: !hasUpstream(),
      tooltip: hasUpstream() ? undefined : "No upstream configured",
    },
    {
      id: "pull_rebase",
      label: "Pull (rebase)",
      disabled: true,
      tooltip: "Awaiting interactive-rebase primitive (#11)",
    },
    {
      id: "force_pull",
      label: "Force pull",
      destructive: true,
      disabled: !hasUpstream(),
      tooltip: hasUpstream()
        ? "Hard-reset HEAD to upstream (destructive)"
        : "No upstream configured",
    },
  ];

  // Push dropdown — chajá deviation from GK (which uses a simple button
  // and surfaces force-push reactively when push fails). The 2-item
  // SplitButton matches the user's expectation of symmetry with Pull.
  const pushOptions = (): SplitButtonOption[] => [
    { id: "push", label: "Push" },
    {
      id: "force_push_lease",
      label: "Force push (with lease)",
      destructive: true,
      tooltip: "Push only if the remote tip still matches the tracking ref",
    },
  ];

  function pullMainLabel(): string {
    switch (pullType()) {
      case "fetch":
        return "Fetch";
      case "pull_ff_only":
        return "Pull (FF)";
      case "pull_rebase":
        return "Pull";
      case "force_pull":
        return "Pull";
      case "pull_merge":
      default:
        return "Pull";
    }
  }

  function runPullDefault() {
    handlePullSelect(pullType());
  }

  return (
    <div class="toolbar">
      <RepoSwitcher onOpenRepo={props.onOpenRepo} />

      <span class="toolbar__arrow">→</span>

      <BranchSwitcher branches={branches() ?? []} active={headBranch()} />

      <UpstreamIndicator
        ahead={aheadCount()}
        behind={behindCount()}
        upstreamShort={upstreamShort()}
      />

      <div class="toolbar__spacer" />

      <div class="toolbar__actions">
        <ToolbarBtn
          icon={<IconUndo />}
          label="Undo"
          disabled={!undoRedoState()?.can_undo}
          title={
            undoRedoState()?.undo_label
              ? `Undo ${undoRedoState()!.undo_label}`
              : "Nothing to undo"
          }
          badge={undoRedoState()?.undo_count}
          onClick={runUndo}
        />
        <ToolbarBtn
          icon={<IconRedo />}
          label="Redo"
          disabled={!undoRedoState()?.can_redo}
          title={
            undoRedoState()?.redo_label
              ? `Redo ${undoRedoState()!.redo_label}`
              : "Nothing to redo"
          }
          badge={undoRedoState()?.redo_count}
          onClick={runRedo}
        />
        <SplitButton
          icon={<IconArrowDown />}
          label={pullMainLabel()}
          options={pullOptions()}
          defaultOptionId={pullType()}
          header={PULL_HEADER}
          buttonDisabled={pullDisabled()}
          dropdownDisabled={pullDisabled()}
          onMainClick={runPullDefault}
          onSelect={handlePullSelect}
          onSetDefault={(id) => setPullType(id as PullType)}
        />
        <SplitButton
          icon={<IconArrowUp />}
          label="Push"
          options={pushOptions()}
          defaultOptionId="push"
          header={PUSH_HEADER}
          buttonDisabled={pushDisabled()}
          dropdownDisabled={pushDisabled()}
          onMainClick={() => void runPush()}
          onSelect={handlePushSelect}
        />
        <ToolbarBtn
          icon={<IconBranch />}
          label="Branch"
          disabled={!hasRepo()}
          onClick={onBranch}
        />
        <ToolbarBtn
          icon={<IconStashIn />}
          label="Stash"
          disabled={stashDisabled() || opInFlight()}
          onClick={onStash}
        />
        <ToolbarBtn
          icon={<IconStashOut />}
          label="Pop"
          disabled={!hasRepo() || opInFlight() || stashEntries() === 0}
          title={
            stashEntries() === 0
              ? "No stashes to pop"
              : `Pop stash (${stashEntries()} available)`
          }
          onClick={onPop}
        />
        <ToolbarBtn icon={<IconTerminal />} label="Terminal" disabled />
      </div>

      <div class="toolbar__spacer" />

      <div class="toolbar__actions toolbar__actions--trailing">
        <ToolbarBtn
          icon={<IconGear />}
          label="Preferences"
          title="Open preferences"
          onClick={() => openPreferences()}
        />
        <Bell />
        <ToolbarBtn icon={<IconSearch />} label="Search" disabled />
      </div>

      <ConfirmDialog
        open={confirm() === "force-pull"}
        title="Force pull?"
        body={`This will fetch ${upstreamShort() ?? "the upstream"} and hard-reset HEAD to it. Local commits not on the upstream will be discarded.`}
        confirmLabel="Force pull"
        destructive
        onConfirm={runForcePull}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm() === "force-push"}
        title="Force push (with lease)?"
        body={`This rewrites ${upstreamShort() ?? "the upstream"} but only if the remote tip still matches your local tracking ref. Coworkers' new commits will block the push.`}
        confirmLabel="Force push"
        destructive
        onConfirm={runForcePushWithLease}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

function ToolbarBtn(props: {
  icon: JSX.Element;
  label: string;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  /// Optional numeric overlay shown at the top-right of the icon.
  /// `> 0` renders the badge; falsy / 0 / undefined hides it. Used by
  /// Undo / Redo to surface how many ops are reachable from the cursor.
  badge?: number;
}) {
  return (
    <button
      class="toolbar__btn"
      type="button"
      disabled={props.disabled}
      title={props.title}
      onClick={props.onClick}
    >
      <span class="toolbar__btn-icon">
        {props.icon}
        <Show when={props.badge && props.badge > 0}>
          <span class="toolbar__btn-badge">{props.badge}</span>
        </Show>
      </span>
      <span class="toolbar__btn-label">{props.label}</span>
    </button>
  );
}
