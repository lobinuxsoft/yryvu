// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createMemo,
  createResource,
  createSignal,
  type JSX,
  onCleanup,
  onMount,
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
import { useBranchOps } from "../../branchOps";
import {
  branchesNonce,
  dirtyFileCount,
  pullType,
  refreshBranches,
  refreshGraph,
  refreshWorkingTree,
  repoPath,
  setPullType,
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
  const [actionsOpen, setActionsOpen] = createSignal(false);
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
    setActionsOpen(false);
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
        <ToolbarBtn icon={<IconUndo />} label="Undo" disabled />
        <ToolbarBtn icon={<IconRedo />} label="Redo" disabled />
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
          label="Actions"
          disabled={!hasRepo() || opInFlight()}
          onClick={() => setActionsOpen((v) => !v)}
        />
        <Bell />
        <ToolbarBtn icon={<IconSearch />} label="Search" disabled />
        <Show when={actionsOpen()}>
          <ActionsDropdown
            onClose={() => setActionsOpen(false)}
            onFetchAll={runFetchAll}
          />
        </Show>
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

function ActionsDropdown(props: {
  onClose: () => void;
  onFetchAll: () => void;
}) {
  let dropdownEl: HTMLDivElement | undefined;

  onMount(() => {
    const onDocPointer = (e: MouseEvent) => {
      if (dropdownEl && !dropdownEl.contains(e.target as Node)) {
        props.onClose();
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("mousedown", onDocPointer);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDocPointer);
      document.removeEventListener("keydown", onKey);
    });
  });

  return (
    <div class="toolbar__actions-dropdown" ref={dropdownEl} role="menu">
      <button
        class="toolbar__actions-item"
        type="button"
        role="menuitem"
        onClick={props.onFetchAll}
      >
        Fetch all
      </button>
      <button
        class="toolbar__actions-item"
        type="button"
        role="menuitem"
        disabled
        title="Awaiting dedicated prune-only backend command"
      >
        Prune remotes
      </button>
      <button
        class="toolbar__actions-item"
        type="button"
        role="menuitem"
        disabled
        title="Awaiting repo_gc backend command"
      >
        Run GC
      </button>
      <button
        class="toolbar__actions-item"
        type="button"
        role="menuitem"
        disabled
        title="Awaiting git clean -fd backend command"
      >
        Clean untracked
      </button>
    </div>
  );
}

function ToolbarBtn(props: {
  icon: JSX.Element;
  label: string;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
}) {
  return (
    <button
      class="toolbar__btn"
      type="button"
      disabled={props.disabled}
      title={props.title}
      onClick={props.onClick}
    >
      <span class="toolbar__btn-icon">{props.icon}</span>
      <span class="toolbar__btn-label">{props.label}</span>
    </button>
  );
}
