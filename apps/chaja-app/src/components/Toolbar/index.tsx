// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createSignal,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";

import {
  fetchPrune,
  pull,
  push,
  stashPop,
  stashPush,
} from "../../ipc";
import { useBranchOps } from "../../branchOps";
import {
  dirtyFileCount,
  refreshBranches,
  refreshGraph,
  refreshWorkingTree,
  repoPath,
} from "../../state";
import {
  IconArrowDown,
  IconArrowUp,
  IconBranch,
  IconChevronDown,
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

const ERROR_DISMISS_MS = 5000;

export function Toolbar(props: ToolbarProps) {
  const ops = useBranchOps();
  const [error, setError] = createSignal<string | null>(null);
  const [pending, setPending] = createSignal<string | null>(null);
  const [actionsOpen, setActionsOpen] = createSignal(false);

  const currentRepoName = () => {
    const p = repoPath();
    if (!p) return undefined;
    return p.split("/").filter(Boolean).pop() ?? p;
  };

  function flashError(msg: string) {
    setError(msg);
    window.setTimeout(() => {
      if (error() === msg) setError(null);
    }, ERROR_DISMISS_MS);
  }

  // After a remote-touching op succeeds, bump both nonces so the graph
  // (commits) and the sidebar (refs / ahead-behind) re-stream. Working-tree
  // nonces are bumped explicitly by callers that touch the workdir.
  function refreshAfterRemoteOp() {
    refreshGraph();
    refreshBranches();
  }

  async function withOp(label: string, fn: () => Promise<void>): Promise<void> {
    const path = repoPath();
    if (!path) return;
    setPending(label);
    try {
      await fn();
    } catch (err) {
      flashError(`${label} failed: ${String(err)}`);
    } finally {
      setPending(null);
    }
  }

  async function onPull() {
    await withOp("Pull", async () => {
      await pull(repoPath()!, "fast-forward-or-merge");
      refreshAfterRemoteOp();
    });
  }

  async function onPush() {
    await withOp("Push", async () => {
      await push(repoPath()!);
      refreshAfterRemoteOp();
    });
  }

  function onBranch() {
    if (!repoPath()) return;
    ops.openCreateDialog();
  }

  async function onStash() {
    await withOp("Stash", async () => {
      await stashPush(repoPath()!);
      refreshWorkingTree();
      refreshAfterRemoteOp();
    });
  }

  async function onPop() {
    await withOp("Stash pop", async () => {
      await stashPop(repoPath()!);
      refreshWorkingTree();
      refreshAfterRemoteOp();
    });
  }

  async function onFetchAll() {
    setActionsOpen(false);
    await withOp("Fetch all", async () => {
      await fetchPrune(repoPath()!);
      refreshAfterRemoteOp();
    });
  }

  const hasRepo = () => repoPath() !== undefined && repoPath() !== "";
  const stashDisabled = () => !hasRepo() || dirtyFileCount() === 0;
  const opInFlight = () => pending() !== null;

  return (
    <div class="toolbar">
      <div class="toolbar__selector">
        <span>repository</span>
        <button class="toolbar__selector-value" type="button" onClick={props.onOpenRepo}>
          <Show when={currentRepoName()} fallback={<em>No repo</em>}>
            {(name) => <>{name()} <span class="toolbar__arrow">▾</span></>}
          </Show>
        </button>
      </div>

      <span class="toolbar__arrow">→</span>

      <div class="toolbar__selector">
        <span>branch</span>
        <button class="toolbar__selector-value" type="button" disabled>
          <em>— </em>
        </button>
      </div>

      <div class="toolbar__spacer" />

      <div class="toolbar__actions">
        <ToolbarBtn icon={<IconUndo />} label="Undo" disabled />
        <ToolbarBtn icon={<IconRedo />} label="Redo" disabled />
        <ToolbarBtn
          icon={<IconArrowDown />}
          label="Pull"
          split
          disabled={!hasRepo() || opInFlight()}
          onClick={onPull}
        />
        <ToolbarBtn
          icon={<IconArrowUp />}
          label="Push"
          disabled={!hasRepo() || opInFlight()}
          onClick={onPush}
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
          disabled={!hasRepo() || opInFlight()}
          onClick={onPop}
        />
        <ToolbarBtn icon={<IconTerminal />} label="Terminal" disabled />
      </div>

      <div class="toolbar__actions toolbar__actions--trailing">
        <ToolbarBtn
          icon={<IconGear />}
          label="Actions"
          disabled={!hasRepo() || opInFlight()}
          onClick={() => setActionsOpen((v) => !v)}
        />
        <ToolbarBtn icon={<IconSearch />} label="Search" disabled />
        <Show when={actionsOpen()}>
          <ActionsDropdown
            onClose={() => setActionsOpen(false)}
            onFetchAll={onFetchAll}
          />
        </Show>
      </div>

      <Show when={pending()}>
        {(p) => <span class="toolbar__pending" aria-live="polite">{p()}…</span>}
      </Show>
      <Show when={error()}>
        {(msg) => (
          <div class="toolbar__error" role="alert" onClick={() => setError(null)}>
            {msg()}
          </div>
        )}
      </Show>
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
  split?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      class="toolbar__btn"
      classList={{ "toolbar__btn-split": props.split }}
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <span class="toolbar__btn-icon">{props.icon}</span>
      <span class="toolbar__btn-label">
        {props.label}
        <Show when={props.split}>
          <span class="toolbar__btn-split-caret">
            <IconChevronDown width="10" height="10" />
          </span>
        </Show>
      </span>
    </button>
  );
}
