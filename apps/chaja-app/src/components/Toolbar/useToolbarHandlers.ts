// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, type Accessor } from "solid-js";

import {
  fetchPrune,
  forcePull,
  pull,
  push,
  stashPop,
  stashPush,
} from "../../ipc";
import {
  pullType,
  refreshBranches,
  refreshGraph,
  refreshWorkingTree,
  repoPath,
  type PullType,
} from "../../state";
import { dismissToast, notify } from "../Notifications";
import type { SplitButtonOption } from "./SplitButton";

export type ConfirmKind = "force-pull" | "force-push";

export interface HandlersOptions {
  hasUpstream: Accessor<boolean>;
}

/**
 * Toolbar imperative ops + dropdown options. Lives in a hook so the
 * component file stays JSX-shaped. The pending state and confirm dialog
 * state belong here too — they're the gates every async op writes to,
 * and exposing them as setters lets `index.tsx` render the dialogs.
 */
export function useToolbarHandlers(opts: HandlersOptions) {
  const [pending, setPending] = createSignal<string | null>(null);
  const [confirm, setConfirm] = createSignal<ConfirmKind | null>(null);

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
        typeof successMessage === "string"
          ? { message: successMessage }
          : undefined,
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
    await withOp(
      "Force pull",
      "Force-pulled (HEAD reset to upstream)",
      async () => {
        await forcePull(repoPath()!);
        refreshAfterRemoteOp();
        refreshWorkingTree();
      },
    );
  }

  async function runPush() {
    await withOp("Push", "Push complete", async () => {
      await push(repoPath()!);
      refreshAfterRemoteOp();
    });
  }

  async function runForcePushWithLease() {
    setConfirm(null);
    await withOp(
      "Force push (with lease)",
      "Force-pushed with lease",
      async () => {
        await push(repoPath()!, { forceWithLease: true });
        refreshAfterRemoteOp();
      },
    );
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

  function runPullDefault() {
    handlePullSelect(pullType());
  }

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

  // Pull dropdown — order matches GitKraken (FETCH, MERGE, FF_ONLY,
  // REBASE) plus chajá's `force_pull` as the destructive 5th item.
  // `pull_rebase` stays disabled until the rebase primitive lands (#11).
  const pullOptions = (): SplitButtonOption[] => [
    { id: "fetch", label: "Fetch all" },
    {
      id: "pull_merge",
      label: "Pull (merge)",
      disabled: !opts.hasUpstream(),
      tooltip: opts.hasUpstream() ? undefined : "No upstream configured",
    },
    {
      id: "pull_ff_only",
      label: "Pull (FF only)",
      disabled: !opts.hasUpstream(),
      tooltip: opts.hasUpstream() ? undefined : "No upstream configured",
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
      disabled: !opts.hasUpstream(),
      tooltip: opts.hasUpstream()
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

  return {
    pending,
    confirm,
    setConfirm,
    runPush,
    runPullDefault,
    runForcePull,
    runForcePushWithLease,
    handlePullSelect,
    handlePushSelect,
    onStash,
    onPop,
    pullMainLabel,
    pullOptions,
    pushOptions,
  };
}

export type ToolbarHandlers = ReturnType<typeof useToolbarHandlers>;
