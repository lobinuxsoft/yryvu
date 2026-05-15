// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, Match, Show, Switch } from "solid-js";
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
import { Comments } from "../Comments";
import { Checks } from "./Checks";
import { Commits } from "./Commits";
import { Conversation } from "./Conversation";
import { Files } from "./Files";
import { MergeForm } from "./MergeForm";
import { MetadataSidebar } from "./MetadataSidebar";
import { Section } from "./Section";

/// Top-level PR detail panel. GK-style layout: header + actions bar
/// on top, then a 2-column body — main column stacks Description /
/// Commits / Files / Checks as collapsible sections (no tab strip),
/// right column pins the metadata sidebar (Author / Branches / Labels
/// / Reviewers / Diff / Mergeability / Timestamps).
export function PullRequestDetailPanel() {
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
                    <span class="pr-detail__number-line">#{detail().number}</span>
                    <h2 class="pr-detail__title">{detail().title}</h2>
                    <div class="pr-detail__subtitle">
                      <span
                        class="pr-detail__state-badge"
                        data-state={detail().draft ? "draft" : detail().state}
                      >
                        {detail().draft ? "draft" : detail().state}
                      </span>
                      <span class="pr-detail__subtitle-text">
                        <strong>{detail().author.login}</strong> wants to merge{" "}
                        <code>{detail().headRef}</code> into{" "}
                        <code>{detail().baseRef}</code>
                      </span>
                    </div>
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
                <div class="pr-detail__body pr-detail__body--grid">
                  <div class="pr-detail__main">
                    <Section title="Description">
                      <Conversation detail={detail()} />
                    </Section>
                    <Section
                      title="Conversation"
                      count={detail().comments}
                    >
                      <Comments
                        contextAccessor={() => {
                          const ref = activePrDetail();
                          if (!ref) return null;
                          return {
                            integrationType: ref.integrationType,
                            owner: ref.owner,
                            repo: ref.repo,
                            target: "pullRequest",
                            number: ref.number,
                          };
                        }}
                      />
                    </Section>
                    <Section
                      title="Commits"
                      count={prDetailCommits()?.length}
                      defaultOpen={false}
                    >
                      <Show
                        when={!prDetailCommits.loading}
                        fallback={<p class="pr-detail__empty">Loading commits…</p>}
                      >
                        <Commits commits={prDetailCommits() ?? []} />
                      </Show>
                    </Section>
                    <Section
                      title="Files changed"
                      count={detail().changedFiles}
                      defaultOpen={false}
                    >
                      <Show
                        when={!prDetailFiles.loading}
                        fallback={<p class="pr-detail__empty">Loading files…</p>}
                      >
                        <Files files={prDetailFiles() ?? []} />
                      </Show>
                    </Section>
                    <Section title="Checks" defaultOpen={false}>
                      <Show
                        when={!prDetailChecks.loading}
                        fallback={<p class="pr-detail__empty">Loading checks…</p>}
                      >
                        <Checks checks={prDetailChecks() ?? []} />
                      </Show>
                    </Section>
                  </div>
                  <MetadataSidebar detail={detail()} />
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
