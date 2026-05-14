// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, For, Match, Show, Switch } from "solid-js";
import { openUrl } from "@tauri-apps/plugin-opener";

import { integrationPrAction, type PrActionVerb } from "../../ipc";
import {
  activePrDetail,
  closePrDetail,
  prDetailChecks,
  prDetailCommits,
  prDetailDetail,
  prDetailFiles,
  refetchAllPrDetail,
} from "../../state/pr-detail";
import { Checks } from "./Checks";
import { Commits } from "./Commits";
import { Conversation } from "./Conversation";
import { Files } from "./Files";
import { MergeForm } from "./MergeForm";

type SubTab = "conversation" | "commits" | "files" | "checks";

const SUB_TABS: Array<{ key: SubTab; label: string }> = [
  { key: "conversation", label: "Conversation" },
  { key: "commits", label: "Commits" },
  { key: "files", label: "Files Changed" },
  { key: "checks", label: "Checks" },
];

/// Top-level PR detail panel. Renders in the central pane (in place
/// of CommitGraph) when `mainView() === "prDetail"`.
export function PullRequestDetailPanel() {
  const [active, setActive] = createSignal<SubTab>("conversation");
  const [actionInFlight, setActionInFlight] = createSignal<PrActionVerb | null>(null);
  const [actionError, setActionError] = createSignal<string | null>(null);
  const [mergeFormOpen, setMergeFormOpen] = createSignal(false);

  async function runAction(verb: PrActionVerb) {
    const ref = activePrDetail();
    if (!ref) return;
    setActionInFlight(verb);
    setActionError(null);
    try {
      await integrationPrAction(
        ref.integrationType,
        ref.owner,
        ref.repo,
        ref.number,
        verb,
      );
      refetchAllPrDetail();
    } catch (err) {
      setActionError(String(err));
    } finally {
      setActionInFlight(null);
    }
  }

  return (
    <div class="pr-detail">
      <Switch
        fallback={
          <Show
            when={prDetailDetail()}
            fallback={<div class="pr-detail__loading">Loading pull request…</div>}
          >
            {(detail) => (
              <>
                <header class="pr-detail__header">
                  <button
                    type="button"
                    class="pr-detail__back"
                    title="Close detail view (back to graph)"
                    onClick={closePrDetail}
                  >
                    ← Back
                  </button>
                  <div class="pr-detail__title-block">
                    <span
                      class="pr-detail__state-badge"
                      data-state={detail().draft ? "draft" : detail().state}
                    >
                      {detail().draft ? "draft" : detail().state}
                    </span>
                    <h2 class="pr-detail__title">
                      {detail().title}{" "}
                      <span class="pr-detail__number">#{detail().number}</span>
                    </h2>
                  </div>
                  <div class="pr-detail__header-actions">
                    <button
                      type="button"
                      class="pr-detail__open-browser"
                      onClick={() => {
                        void openUrl(detail().htmlUrl);
                      }}
                      title="Open pull request in browser"
                    >
                      Open in browser ↗
                    </button>
                  </div>
                </header>
                <div class="pr-detail__actions-bar">
                  <Show
                    when={
                      detail().state === "open" &&
                      !detail().draft &&
                      detail().mergeableState === "clean"
                    }
                  >
                    <button
                      type="button"
                      class="pr-detail__action-btn pr-detail__action-btn--primary"
                      disabled={actionInFlight() !== null || mergeFormOpen()}
                      onClick={() => setMergeFormOpen(true)}
                    >
                      Merge PR
                    </button>
                  </Show>
                  <Show when={detail().state === "open"}>
                    <button
                      type="button"
                      class="pr-detail__action-btn"
                      disabled={actionInFlight() !== null}
                      onClick={() => runAction("close")}
                    >
                      Close PR
                    </button>
                    <Show
                      when={!detail().draft}
                      fallback={
                        <button
                          type="button"
                          class="pr-detail__action-btn"
                          disabled={actionInFlight() !== null}
                          onClick={() => runAction("markReadyForReview")}
                        >
                          Mark ready for review
                        </button>
                      }
                    >
                      <button
                        type="button"
                        class="pr-detail__action-btn"
                        disabled={actionInFlight() !== null}
                        onClick={() => runAction("convertToDraft")}
                      >
                        Convert to draft
                      </button>
                    </Show>
                  </Show>
                  <Show when={detail().state === "closed"}>
                    <button
                      type="button"
                      class="pr-detail__action-btn"
                      disabled={actionInFlight() !== null}
                      onClick={() => runAction("reopen")}
                    >
                      Reopen PR
                    </button>
                  </Show>
                  <Show when={actionInFlight()}>
                    <span class="pr-detail__action-status">
                      Applying {actionInFlight()}…
                    </span>
                  </Show>
                  <Show when={actionError()}>
                    {(err) => (
                      <span class="pr-detail__action-error">{err()}</span>
                    )}
                  </Show>
                </div>
                <Show when={mergeFormOpen()}>
                  <MergeForm
                    detail={detail()}
                    onClose={() => setMergeFormOpen(false)}
                  />
                </Show>
                <nav class="pr-detail__subtabs">
                  <For each={SUB_TABS}>
                    {(t) => (
                      <button
                        type="button"
                        class="pr-detail__subtab"
                        data-active={active() === t.key ? "true" : "false"}
                        onClick={() => setActive(t.key)}
                      >
                        {t.label}
                      </button>
                    )}
                  </For>
                </nav>
                <div class="pr-detail__body">
                  <Switch>
                    <Match when={active() === "conversation"}>
                      <Conversation detail={detail()} />
                    </Match>
                    <Match when={active() === "commits"}>
                      <Show
                        when={!prDetailCommits.loading}
                        fallback={<p class="pr-detail__empty">Loading commits…</p>}
                      >
                        <Commits commits={prDetailCommits() ?? []} />
                      </Show>
                    </Match>
                    <Match when={active() === "files"}>
                      <Show
                        when={!prDetailFiles.loading}
                        fallback={<p class="pr-detail__empty">Loading files…</p>}
                      >
                        <Files files={prDetailFiles() ?? []} />
                      </Show>
                    </Match>
                    <Match when={active() === "checks"}>
                      <Show
                        when={!prDetailChecks.loading}
                        fallback={<p class="pr-detail__empty">Loading checks…</p>}
                      >
                        <Checks checks={prDetailChecks() ?? []} />
                      </Show>
                    </Match>
                  </Switch>
                </div>
              </>
            )}
          </Show>
        }
      >
        <Match when={prDetailDetail.error}>
          {(err) => (
            <div class="pr-detail__error">
              <p>Failed to load pull request: {String(err())}</p>
              <button type="button" class="pr-detail__back" onClick={closePrDetail}>
                ← Back to graph
              </button>
            </div>
          )}
        </Match>
      </Switch>
    </div>
  );
}
