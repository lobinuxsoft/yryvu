// SPDX-License-Identifier: AGPL-3.0-or-later

import { For, Show } from "solid-js";

import { Dialog } from "../../Dialog";
import type { BranchOps } from "../../../branchOps";
import type { GitflowFlow } from "../types";

const TITLE: Record<GitflowFlow, string> = {
  feature: "Finish feature",
  release: "Finish release",
  hotfix: "Finish hotfix",
  github: "Finish branch (GitHub Flow)",
};

/// Release / hotfix tag the production tip; feature / GitHub Flow don't.
const TAGS = (flow: GitflowFlow) => flow === "release" || flow === "hotfix";

export function GitflowFinishDialog(props: { ops: BranchOps }) {
  const { ops } = props;
  const state = () => {
    const d = ops.dialog();
    return d?.kind === "gitflow-finish" ? d : null;
  };
  const flow = (): GitflowFlow => state()?.flow ?? "feature";
  const candidates = () => state()?.candidates ?? [];

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
            disabled={!ops.gitflowName().trim()}
            onClick={ops.submitGitflowFinish}
          >
            Finish
          </button>
        </>
      }
    >
      <div class="dialog__field">
        <label for="gitflow-finish-branch">Branch</label>
        <select
          id="gitflow-finish-branch"
          value={ops.gitflowName()}
          onChange={(e) => ops.setGitflowName(e.currentTarget.value)}
        >
          <For each={candidates()}>
            {(name) => <option value={name}>{name}</option>}
          </For>
        </select>
      </div>

      <Show when={flow() === "github"}>
        <p
          class="dialog__field"
          style={{ color: "var(--fg-2)", "font-size": "12px" }}
        >
          Merges into <code>{ops.gitflowBase()}</code>
        </p>
      </Show>

      <Show when={TAGS(flow())}>
        <div class="dialog__field">
          <label for="gitflow-tag-message">Tag message (optional)</label>
          <input
            id="gitflow-tag-message"
            type="text"
            value={ops.gitflowTagMessage()}
            placeholder="Leave empty for a lightweight tag"
            onInput={(e) => ops.setGitflowTagMessage(e.currentTarget.value)}
          />
        </div>
      </Show>

      <label class="dialog__field" style={{ "flex-direction": "row", gap: "8px" }}>
        <input
          type="checkbox"
          checked={!ops.gitflowKeepBranch()}
          onChange={(e) => ops.setGitflowKeepBranch(!e.currentTarget.checked)}
        />
        Delete branch after finishing
      </label>

      <Show when={ops.dialogError()}>
        <p class="dialog__error">{ops.dialogError()}</p>
      </Show>
    </Dialog>
  );
}
