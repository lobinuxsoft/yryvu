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
import { openAbout } from "../About";
import { Bell } from "../Notifications";
import { BranchSwitcher } from "./BranchSwitcher";
import { ConfirmDialog } from "./ConfirmDialog";
import { ProfilePicker } from "./ProfilePicker";
import { RepoSwitcher } from "./RepoSwitcher";
import { SplitButton } from "./SplitButton";
import { ToolbarBtn } from "./ToolbarBtn";
import { UpstreamIndicator } from "./UpstreamIndicator";

import { useToolbarData } from "./useToolbarData";
import { useToolbarHandlers } from "./useToolbarHandlers";
import { Icon } from "../Icon";

export interface ToolbarProps {
  onOpenRepo: () => void;
}

const PULL_HEADER = "Choose your pull strategy";
const PUSH_HEADER = "Push options";

/// Tooltip for the Undo / Redo buttons. `lostWork` marks an entry that was
/// applied over a dirty tree with force: the button still moves HEAD, but
/// the uncommitted work discarded back then is unrecoverable, and the
/// tooltip is the only place that can say so before the click (#475).
function undoRedoTitle(
  verb: "Undo" | "Redo",
  label: string | null | undefined,
  lostWork: boolean | undefined,
): string {
  if (!label) return `Nothing to ${verb.toLowerCase()}`;
  const base = `${verb} ${label}`;
  return lostWork
    ? `${base} — does not restore the uncommitted changes that were discarded`
    : base;
}

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
          icon={<Icon name="undo" />}
          label="Undo"
          disabled={!undoRedoState()?.can_undo}
          title={undoRedoTitle(
            "Undo",
            undoRedoState()?.undo_label,
            undoRedoState()?.undo_lost_work,
          )}
          badge={undoRedoState()?.undo_count}
          onClick={runUndo}
        />
        <ToolbarBtn
          icon={<Icon name="redo" />}
          label="Redo"
          disabled={!undoRedoState()?.can_redo}
          title={undoRedoTitle(
            "Redo",
            undoRedoState()?.redo_label,
            undoRedoState()?.redo_lost_work,
          )}
          badge={undoRedoState()?.redo_count}
          onClick={runRedo}
        />
        <SplitButton
          icon={<Icon name="arrow-down" />}
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
          icon={<Icon name="arrow-up" />}
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
          icon={<Icon name="branch" />}
          label="Branch"
          disabled={!hasRepo()}
          onClick={onBranch}
        />
        <ToolbarBtn
          icon={<Icon name="stash-in" />}
          label="Stash"
          disabled={stashDisabled() || opInFlight()}
          onClick={handlers.onStash}
        />
        <ToolbarBtn
          icon={<Icon name="stash-out" />}
          label="Pop"
          disabled={!hasRepo() || opInFlight() || data.stashEntries() === 0}
          title={
            data.stashEntries() === 0
              ? "No stashes to pop"
              : `Pop stash (${data.stashEntries()} available)`
          }
          onClick={handlers.onPop}
        />
        <ToolbarBtn icon={<Icon name="terminal" />} label="Terminal" disabled />
      </div>

      <div class="toolbar__spacer" />

      <div class="toolbar__actions toolbar__actions--trailing">
        <ToolbarBtn
          icon={<Icon name="info" />}
          label="About"
          title="About Yryvu"
          onClick={openAbout}
        />
        <ToolbarBtn
          icon={<Icon name="gear" />}
          label="Preferences"
          title="Open preferences"
          onClick={() => openPreferences()}
        />
        <ProfilePicker />
        <Bell />
        <ToolbarBtn icon={<Icon name="search" />} label="Search" disabled />
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
        suppressible
        onConfirm={handlers.runForcePushWithLease}
        onCancel={() => handlers.setConfirm(null)}
      />
    </div>
  );
}
