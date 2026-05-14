// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, For, Show } from "solid-js";

import { integrationMergePr, type MergeMethod, type PullRequestDetail } from "../../ipc";
import { activePrDetail, refetchAllPrDetail } from "../../state/pr-detail";

interface MergeFormProps {
  detail: PullRequestDetail;
  onClose: () => void;
}

const METHODS: Array<{ value: MergeMethod; label: string; hint: string }> = [
  {
    value: "merge",
    label: "Create a merge commit",
    hint: "All commits from this branch will be added to the base branch via a merge commit.",
  },
  {
    value: "squash",
    label: "Squash and merge",
    hint: "The commits will be combined into one commit in the base branch.",
  },
  {
    value: "rebase",
    label: "Rebase and merge",
    hint: "The commits will be rebased and added individually to the base branch.",
  },
];

/// Pre-fill the commit-message textarea from the PR's body when
/// using squash/merge methods. Rebase doesn't take a custom message
/// (GitHub keeps each original commit), so we hide the field there.
function defaultMessage(detail: PullRequestDetail, method: MergeMethod): string {
  if (method === "rebase") return "";
  return detail.body;
}

export function MergeForm(props: MergeFormProps) {
  const [method, setMethod] = createSignal<MergeMethod>("merge");
  const [title, setTitle] = createSignal(props.detail.title);
  const [message, setMessage] = createSignal(defaultMessage(props.detail, "merge"));
  const [deleteBranch, setDeleteBranch] = createSignal(true);
  const [inFlight, setInFlight] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  const onMethodChange = (next: MergeMethod) => {
    setMethod(next);
    setMessage(defaultMessage(props.detail, next));
  };

  const onConfirm = async () => {
    const ref = activePrDetail();
    if (!ref) return;
    setInFlight(true);
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
          commitMessage:
            method() === "rebase" ? undefined : message().trim() || undefined,
          deleteSourceBranch: deleteBranch(),
        },
      );
      refetchAllPrDetail();
      props.onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setInFlight(false);
    }
  };

  return (
    <div class="pr-detail__merge-form">
      <h3 class="pr-detail__merge-title">Merge pull request</h3>
      <fieldset class="pr-detail__merge-methods" disabled={inFlight()}>
        <For each={METHODS}>
          {(opt) => (
            <label class="pr-detail__merge-method">
              <input
                type="radio"
                name="merge-method"
                value={opt.value}
                checked={method() === opt.value}
                onChange={() => onMethodChange(opt.value)}
              />
              <span class="pr-detail__merge-method-label">{opt.label}</span>
              <span class="pr-detail__merge-method-hint">{opt.hint}</span>
            </label>
          )}
        </For>
      </fieldset>

      <Show when={method() !== "rebase"}>
        <label class="pr-detail__merge-field">
          <span class="pr-detail__merge-field-label">Commit title</span>
          <input
            type="text"
            class="pr-detail__merge-input"
            value={title()}
            disabled={inFlight()}
            onInput={(e) => setTitle(e.currentTarget.value)}
          />
        </label>
        <label class="pr-detail__merge-field">
          <span class="pr-detail__merge-field-label">Commit message</span>
          <textarea
            class="pr-detail__merge-textarea"
            rows={6}
            value={message()}
            disabled={inFlight()}
            onInput={(e) => setMessage(e.currentTarget.value)}
          />
        </label>
      </Show>

      <label class="pr-detail__merge-checkbox">
        <input
          type="checkbox"
          checked={deleteBranch()}
          disabled={inFlight()}
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
          disabled={inFlight()}
          onClick={props.onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          class="pr-detail__action-btn pr-detail__action-btn--primary"
          disabled={inFlight()}
          onClick={() => {
            void onConfirm();
          }}
        >
          {inFlight() ? "Merging…" : `Confirm ${method()}`}
        </button>
      </div>
    </div>
  );
}
