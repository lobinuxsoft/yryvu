// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { Dialog } from "../../Dialog";
import type { BranchOps } from "../../../branchOps";
import type { GitflowFlow } from "../types";

const TITLE: Record<GitflowFlow, string> = {
  feature: "Start feature",
  release: "Start release",
  hotfix: "Start hotfix",
  github: "Start branch (GitHub Flow)",
};

const NAME_LABEL: Record<GitflowFlow, string> = {
  feature: "Feature name",
  release: "Version",
  hotfix: "Version",
  github: "Branch name",
};

const NAME_PLACEHOLDER: Record<GitflowFlow, string> = {
  feature: "login-form",
  release: "1.2.0",
  hotfix: "1.2.1",
  github: "fix-typo",
};

export function GitflowStartDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const state = () => {
    const d = ops.dialog();
    return d?.kind === "gitflow-start" ? d : null;
  };
  const flow = (): GitflowFlow => state()?.flow ?? "feature";

  return (
    <Dialog
      open={state() !== null}
      title={TITLE[flow()]}
      onClose={ops.closeDialog}
      footer={
        <>
          <button
            class="dialog__btn"
            type="button"
            data-dismiss
            onClick={ops.closeDialog}
          >
            Cancel
          </button>
          <button
            class="dialog__btn dialog__btn--primary"
            type="button"
            disabled={
              !ops.gitflowName().trim() ||
              (flow() === "github" && !ops.gitflowBase().trim())
            }
            onClick={ops.submitGitflowStart}
          >
            Start
          </button>
        </>
      }
    >
      <Show when={flow() === "github"}>
        <div class="dialog__field">
          <label for="gitflow-base">Base branch</label>
          <input
            id="gitflow-base"
            type="text"
            value={ops.gitflowBase()}
            placeholder="main"
            onInput={(e) => ops.setGitflowBase(e.currentTarget.value)}
          />
        </div>
      </Show>
      <div class="dialog__field">
        <label for="gitflow-name">{NAME_LABEL[flow()]}</label>
        <input
          id="gitflow-name"
          type="text"
          value={ops.gitflowName()}
          placeholder={NAME_PLACEHOLDER[flow()]}
          onInput={(e) => ops.setGitflowName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") ops.submitGitflowStart();
          }}
        />
      </div>
      <Show when={ops.dialogError()}>
        <p class="dialog__error">{ops.dialogError()}</p>
      </Show>
    </Dialog>
  );
}
