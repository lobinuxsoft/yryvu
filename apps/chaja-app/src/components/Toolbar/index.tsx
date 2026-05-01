// SPDX-License-Identifier: AGPL-3.0-or-later

import { runRedo, runUndo } from "../../undoOps";
import { useBranchOps } from "../../branchOps";
import {
  openPreferences,
  pullType,
  repoPath,
  setPullType,
  undoRedoState,
  type PullType,
} from "../../state";
import { Bell } from "../Notifications";
import { BranchSwitcher } from "./BranchSwitcher";
import { ConfirmDialog } from "./ConfirmDialog";
import { RepoSwitcher } from "./RepoSwitcher";
import { SplitButton } from "./SplitButton";
import { ToolbarBtn } from "./ToolbarBtn";
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
import { useToolbarData } from "./useToolbarData";
import { useToolbarHandlers } from "./useToolbarHandlers";

export interface ToolbarProps {
  onOpenRepo: () => void;
}

const PULL_HEADER = "Choose your pull strategy";
const PUSH_HEADER = "Push options";

export function Toolbar(props: ToolbarProps) {
  const ops = useBranchOps();
  const data = useToolbarData();
  const handlers = useToolbarHandlers({ hasUpstream: data.hasUpstream });

  const hasRepo = () => repoPath() !== undefined && repoPath() !== "";
  const opInFlight = () => handlers.pending() !== null;
  const stashDisabled = () => !hasRepo() || data.stashEntries() === 0;
  const pullDisabled = () => !hasRepo() || opInFlight();
  const pushDisabled = () => !hasRepo() || opInFlight();

  function onBranch() {
    if (!repoPath()) return;
    ops.openCreateDialog();
  }

  return (
    <div class="toolbar">
      <RepoSwitcher onOpenRepo={props.onOpenRepo} />

      <span class="toolbar__arrow">→</span>

      <BranchSwitcher branches={data.branches() ?? []} active={data.headBranch()} />

      <UpstreamIndicator
        ahead={data.aheadCount()}
        behind={data.behindCount()}
        upstreamShort={data.upstreamShort()}
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
          label={handlers.pullMainLabel()}
          options={handlers.pullOptions()}
          defaultOptionId={pullType()}
          header={PULL_HEADER}
          buttonDisabled={pullDisabled()}
          dropdownDisabled={pullDisabled()}
          onMainClick={handlers.runPullDefault}
          onSelect={handlers.handlePullSelect}
          onSetDefault={(id) => setPullType(id as PullType)}
        />
        <SplitButton
          icon={<IconArrowUp />}
          label="Push"
          options={handlers.pushOptions()}
          defaultOptionId="push"
          header={PUSH_HEADER}
          buttonDisabled={pushDisabled()}
          dropdownDisabled={pushDisabled()}
          onMainClick={() => void handlers.runPush()}
          onSelect={handlers.handlePushSelect}
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
          onClick={handlers.onStash}
        />
        <ToolbarBtn
          icon={<IconStashOut />}
          label="Pop"
          disabled={!hasRepo() || opInFlight() || data.stashEntries() === 0}
          title={
            data.stashEntries() === 0
              ? "No stashes to pop"
              : `Pop stash (${data.stashEntries()} available)`
          }
          onClick={handlers.onPop}
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
        open={handlers.confirm() === "force-pull"}
        title="Force pull?"
        body={`This will fetch ${data.upstreamShort() ?? "the upstream"} and hard-reset HEAD to it. Local commits not on the upstream will be discarded.`}
        confirmLabel="Force pull"
        destructive
        onConfirm={handlers.runForcePull}
        onCancel={() => handlers.setConfirm(null)}
      />
      <ConfirmDialog
        open={handlers.confirm() === "force-push"}
        title="Force push (with lease)?"
        body={`This rewrites ${data.upstreamShort() ?? "the upstream"} but only if the remote tip still matches your local tracking ref. Coworkers' new commits will block the push.`}
        confirmLabel="Force push"
        destructive
        onConfirm={handlers.runForcePushWithLease}
        onCancel={() => handlers.setConfirm(null)}
      />
    </div>
  );
}
