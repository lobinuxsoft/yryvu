// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Show,
  createEffect,
  createResource,
  createSignal,
  type JSX,
} from "solid-js";

import {
  getRepoIssueTrackerUrl,
  resolveIssueTrackerPattern,
  setRepoIssueTrackerUrl,
  type IssueTrackerPreferences,
} from "../../../ipc";
import { preferences, updatePreferences } from "../../../state/preferences";
import { repoPath } from "../../../state";

/// Empty / whitespace input → `null` (matches `Tools.tsx` convention).
function normalize(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Issue Tracker preferences panel — global default + per-repo override
 * (issue #306). Backend in the same PR (full scope C).
 *
 * Global default + linkify / auto-detect toggles live in the JSON
 * preferences file. The per-repo override lives in the repo's own
 * `.git/config [yryvu] issueTrackerUrl` so it doesn't pollute the
 * user-wide JSON. The "Detect from origin" affordance previews what
 * the resolver would pick for the active repo so the user can either
 * accept it as the override or write their own.
 */
export function IssueTrackerPanel(): JSX.Element {
  const [globalPatternLocal, setGlobalPatternLocal] = createSignal("");
  const [overrideLocal, setOverrideLocal] = createSignal("");

  createEffect(() => {
    const prefs = preferences();
    if (!prefs) return;
    setGlobalPatternLocal(prefs.issueTracker.defaultUrlPattern ?? "");
  });

  // Per-repo override — fetched fresh whenever `repoPath()` changes.
  const [override, { refetch: refetchOverride }] = createResource<
    string | null,
    string
  >(
    () => repoPath(),
    (path) => getRepoIssueTrackerUrl(path),
  );

  createEffect(() => {
    const v = override();
    setOverrideLocal(v ?? "");
  });

  const persistGlobal = (patch: Partial<IssueTrackerPreferences>) => {
    if (!preferences()) return;
    void updatePreferences({ issueTracker: patch });
  };

  const persistOverride = async (next: string | null) => {
    const path = repoPath();
    if (!path) return;
    try {
      await setRepoIssueTrackerUrl(path, next);
      await refetchOverride();
    } catch (err) {
      console.error("setRepoIssueTrackerUrl failed:", err);
    }
  };

  const detectFromOrigin = async () => {
    const path = repoPath();
    if (!path) return;
    try {
      const detected = await resolveIssueTrackerPattern(path);
      if (detected) setOverrideLocal(detected);
    } catch (err) {
      console.error("resolveIssueTrackerPattern failed:", err);
    }
  };

  const ready = () => preferences() !== undefined;
  const linkifyValue = () => preferences()?.issueTracker.linkifyInCommits ?? true;
  const autoDetectValue = () =>
    preferences()?.issueTracker.autoDetectProvider ?? true;

  return (
    <div class="preferences__section-body">
      <h3 class="preferences__section-title">Global default</h3>
      <p class="ui-panel__helper">
        The fallback URL pattern when auto-detect can't classify the repo's
        origin and no per-repo override is set. Use{" "}
        <code>{"{owner}"}</code>, <code>{"{repo}"}</code>, and{" "}
        <code>{"{id}"}</code> placeholders — e.g.{" "}
        <code>https://example.com/{"{owner}"}/{"{repo}"}/issues/{"{id}"}</code>.
      </p>

      <div class="issue-tracker-panel__field">
        <label class="ui-panel__label" for="issue-tracker-default-pattern">
          Default URL pattern
        </label>
        <input
          id="issue-tracker-default-pattern"
          class="issue-tracker-panel__input"
          type="text"
          placeholder="https://example.com/{owner}/{repo}/issues/{id}"
          value={globalPatternLocal()}
          disabled={!ready()}
          onInput={(e) => setGlobalPatternLocal(e.currentTarget.value)}
          onChange={(e) =>
            persistGlobal({ defaultUrlPattern: normalize(e.currentTarget.value) })
          }
        />
      </div>

      <label class="notifications-panel__row">
        <input
          type="checkbox"
          class="notifications-panel__toggle"
          checked={autoDetectValue()}
          disabled={!ready()}
          onChange={(e) =>
            persistGlobal({ autoDetectProvider: e.currentTarget.checked })
          }
        />
        <span class="notifications-panel__label">
          <span class="notifications-panel__label-text">Auto-detect provider</span>
          <span class="notifications-panel__hint">
            Inspect origin to build the canonical pattern for GitHub /
            GitLab / Bitbucket / Gitea.
          </span>
        </span>
      </label>

      <label class="notifications-panel__row">
        <input
          type="checkbox"
          class="notifications-panel__toggle"
          checked={linkifyValue()}
          disabled={!ready()}
          onChange={(e) =>
            persistGlobal({ linkifyInCommits: e.currentTarget.checked })
          }
        />
        <span class="notifications-panel__label">
          <span class="notifications-panel__label-text">
            Linkify issue refs in commit messages
          </span>
          <span class="notifications-panel__hint">
            Render <code>#123</code> as a link in commit message viewers.
            Refs stay plain text when no pattern resolves.
          </span>
        </span>
      </label>

      <h3 class="preferences__section-title issue-tracker-panel__sub-heading">
        Per-repo override
      </h3>

      <Show
        when={repoPath() !== undefined}
        fallback={
          <p class="ui-panel__helper">
            Open a repository to configure its issue tracker URL. The
            override is stored in <code>.git/config</code> under{" "}
            <code>[yryvu] issueTrackerUrl</code>, so it travels with the
            clone and never leaks to other repos.
          </p>
        }
      >
        <p class="ui-panel__helper">
          Override the resolver for this repo. Leave empty to clear the
          override and fall back to auto-detect / the global default.
        </p>
        <div class="issue-tracker-panel__field">
          <label class="ui-panel__label" for="issue-tracker-override">
            URL pattern for this repo
          </label>
          <input
            id="issue-tracker-override"
            class="issue-tracker-panel__input"
            type="text"
            placeholder="https://example.com/{owner}/{repo}/issues/{id}"
            value={overrideLocal()}
            disabled={!ready()}
            onInput={(e) => setOverrideLocal(e.currentTarget.value)}
            onChange={(e) =>
              void persistOverride(normalize(e.currentTarget.value))
            }
          />
        </div>
        <div class="issue-tracker-panel__actions">
          <button
            type="button"
            class="ui-panel__btn ui-panel__btn--secondary"
            onClick={detectFromOrigin}
            disabled={!ready()}
          >
            Detect from origin
          </button>
        </div>
      </Show>
    </div>
  );
}
