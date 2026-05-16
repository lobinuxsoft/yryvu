// SPDX-License-Identifier: AGPL-3.0-or-later

import { createMemo, createSignal, For, Show } from "solid-js";

import {
  integrationMergePr,
  integrationRebaseMr,
  type MergeMethod,
  type ProjectMergeSettings,
  type PullRequestDetail,
} from "../../ipc";
import { activePrDetail, refetchAllPrDetail } from "../../state/pr-detail";
import { Tooltip } from "../Tooltip";
import {
  defaultMethod,
  mergeMethodHint,
  methodAllowed,
  squashState,
} from "./mergeFormGitlab.gating";

interface MergeFormGitlabProps {
  detail: PullRequestDetail;
  onClose: () => void;
}

interface MethodOption {
  value: MergeMethod;
  label: string;
  hint: string;
}

const METHODS: MethodOption[] = [
  {
    value: "merge",
    label: "Create a merge commit",
    hint: "All commits land via a merge commit on the target branch.",
  },
  {
    value: "squash",
    label: "Squash and merge",
    hint: "Combine all commits into one before merging.",
  },
  {
    value: "rebase",
    label: "Rebase and merge",
    hint: "Rebase commits onto target, then merge linearly.",
  },
];

/// Fall back to a permissive setting when the backend didn't surface a
/// project policy (rare — GitLab returns it as long as the introspection
/// API is enabled). Permissive defaults keep the form usable in degraded
/// mode rather than blocking the user with empty controls.
const PERMISSIVE_FALLBACK: ProjectMergeSettings = {
  mergeMethod: "merge",
  squashOption: "defaultOff",
  removeSourceBranchAfterMergeDefault: true,
  allowMergeOnSkippedPipeline: true,
};

export function MergeFormGitlab(props: MergeFormGitlabProps) {
  const settings = createMemo<ProjectMergeSettings>(
    () => props.detail.projectSettings ?? PERMISSIVE_FALLBACK,
  );
  const squash = createMemo(() => squashState(settings().squashOption));

  const [method, setMethod] = createSignal<MergeMethod>(
    defaultMethod(settings().mergeMethod),
  );
  const [title, setTitle] = createSignal(props.detail.title);
  const [message, setMessage] = createSignal(props.detail.body);
  const [squashChecked, setSquashChecked] = createSignal(
    squash().defaultChecked,
  );
  const [deleteBranch, setDeleteBranch] = createSignal(
    settings().removeSourceBranchAfterMergeDefault,
  );
  const [skipCi, setSkipCi] = createSignal(false);
  const [inFlight, setInFlight] = createSignal<"merge" | "rebase" | null>(null);
  const [error, setError] = createSignal<string | null>(null);

  /// The squash flag we send to the backend: forced true when the
  /// Squash radio is picked (radio shortcut), otherwise honour the
  /// independent checkbox (which itself respects the project policy).
  const effectiveSquash = createMemo(() => {
    if (method() === "squash") return true;
    return squashChecked();
  });

  const onConfirm = async () => {
    const ref = activePrDetail();
    if (!ref) return;
    setInFlight("merge");
    setError(null);
    try {
      await integrationMergePr(
        ref.integrationType,
        ref.owner,
        ref.repo,
        ref.number,
        {
          method: method(),
          commitTitle: title().trim() || undefined,
          commitMessage: message().trim() || undefined,
          deleteSourceBranch: deleteBranch(),
          squash: effectiveSquash(),
        },
      );
      refetchAllPrDetail();
      props.onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setInFlight(null);
    }
  };

  const onRebase = async () => {
    const ref = activePrDetail();
    if (!ref) return;
    setInFlight("rebase");
    setError(null);
    try {
      await integrationRebaseMr(
        ref.integrationType,
        ref.owner,
        ref.repo,
        ref.number,
        skipCi(),
      );
      refetchAllPrDetail();
    } catch (err) {
      setError(String(err));
    } finally {
      setInFlight(null);
    }
  };

  return (
    <div class="pr-detail__merge-form">
      <div class="pr-detail__merge-header">
        <h3 class="pr-detail__merge-title">Merge merge request</h3>
        <div class="pr-detail__merge-rebase">
          <label class="pr-detail__merge-checkbox pr-detail__merge-checkbox--inline">
            <input
              type="checkbox"
              checked={skipCi()}
              disabled={inFlight() !== null}
              onChange={(e) => setSkipCi(e.currentTarget.checked)}
            />
            <span>Skip CI on rebase</span>
          </label>
          <Tooltip text="Rebase source branch onto target without merging">
            <button
              type="button"
              class="pr-detail__action-btn"
              disabled={inFlight() !== null}
              onClick={() => {
                void onRebase();
              }}
            >
              {inFlight() === "rebase" ? "Rebasing…" : "Rebase"}
            </button>
          </Tooltip>
        </div>
      </div>

      <fieldset class="pr-detail__merge-methods" disabled={inFlight() !== null}>
        <For each={METHODS}>
          {(opt) => {
            const allowed = createMemo(() =>
              methodAllowed(settings().mergeMethod, opt.value),
            );
            return (
              <label
                class="pr-detail__merge-method"
                classList={{
                  "pr-detail__merge-method--disabled": !allowed(),
                }}
              >
                <input
                  type="radio"
                  name="merge-method"
                  value={opt.value}
                  checked={method() === opt.value}
                  disabled={!allowed()}
                  onChange={() => setMethod(opt.value)}
                />
                <span class="pr-detail__merge-method-label">{opt.label}</span>
                <span class="pr-detail__merge-method-hint">{opt.hint}</span>
              </label>
            );
          }}
        </For>
      </fieldset>
      <p class="pr-detail__merge-method-policy">
        {mergeMethodHint(settings().mergeMethod)}
      </p>

      <label class="pr-detail__merge-field">
        <span class="pr-detail__merge-field-label">Commit title</span>
        <input
          type="text"
          class="pr-detail__merge-input"
          value={title()}
          disabled={inFlight() !== null}
          onInput={(e) => setTitle(e.currentTarget.value)}
        />
      </label>
      <label class="pr-detail__merge-field">
        <span class="pr-detail__merge-field-label">Commit message</span>
        <textarea
          class="pr-detail__merge-textarea"
          rows={6}
          value={message()}
          disabled={inFlight() !== null}
          onInput={(e) => setMessage(e.currentTarget.value)}
        />
      </label>

      <Show when={squash().visible && method() !== "squash"}>
        <label class="pr-detail__merge-checkbox">
          <input
            type="checkbox"
            checked={squashChecked() || squash().locked}
            disabled={inFlight() !== null || squash().locked}
            onChange={(e) => setSquashChecked(e.currentTarget.checked)}
          />
          <span>
            Squash commits when merging
            <Show when={squash().locked}>
              {" "}
              <em class="pr-detail__merge-method-hint">(required by project)</em>
            </Show>
          </span>
        </label>
      </Show>

      <label class="pr-detail__merge-checkbox">
        <input
          type="checkbox"
          checked={deleteBranch()}
          disabled={inFlight() !== null}
          onChange={(e) => setDeleteBranch(e.currentTarget.checked)}
        />
        <span>
          Delete source branch{" "}
          <code class="pr-detail__inline-code">{props.detail.headRef}</code> after
          merge
        </span>
      </label>

      <Show when={error()}>
        {(err) => <p class="pr-detail__merge-error">{err()}</p>}
      </Show>

      <div class="pr-detail__merge-actions">
        <button
          type="button"
          class="pr-detail__action-btn"
          disabled={inFlight() !== null}
          onClick={props.onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          class="pr-detail__action-btn pr-detail__action-btn--primary"
          disabled={inFlight() !== null}
          onClick={() => {
            void onConfirm();
          }}
        >
          {inFlight() === "merge"
            ? "Merging…"
            : `Confirm ${method()}`}
        </button>
      </div>
    </div>
  );
}
