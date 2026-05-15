// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  createMemo,
  createResource,
  createSignal,
  For,
  Match,
  Show,
  Switch,
} from "solid-js";
import { open as openPicker } from "@tauri-apps/plugin-dialog";

import {
  integrationListCloneCandidates,
  type CloneRepoCandidate,
} from "../../../ipc";
import { openPreferences } from "../../../state/preferences";
import {
  setActiveIntegrationProvider,
} from "../../PreferencesWindow/panels/Integrations";
import { integrationState } from "../../PreferencesWindow/panels/Integrations/state";
import type { ProviderInfo } from "../../PreferencesWindow/panels/Integrations/providerTable";
import { ProgressBar } from "../../ProgressBar";
import { phaseLabel } from "./phaseLabel";
import { closeCloneDialog, cloneDialog } from "./state";
import { cancelCloneDialog, submitCloneDialog } from "./submit";
import {
  filterCandidates,
  groupCandidates,
  renderModeFor,
} from "./cloneFromProvider.helpers";

interface CloneFromProviderProps {
  provider: ProviderInfo;
}

/// Single parametric component handling all 7 provider sub-tabs in
/// the Clone dialog (#374). Routes between three render modes based
/// on the live integration state + provider cohort: connected (full
/// form), disconnected (CTA → Preferences), backend-pending (hint).
/// One component, no per-provider boilerplate.
export function CloneFromProvider(props: CloneFromProviderProps) {
  const state = () => integrationState(props.provider.type)();
  const mode = createMemo(() => renderModeFor(props.provider, state()));

  const onConnectClicked = () => {
    closeCloneDialog();
    setActiveIntegrationProvider(props.provider.type);
    openPreferences("integrations");
  };

  return (
    <div class="onboarding-dialog__panel">
      <h3 class="onboarding-dialog__panel-title">Clone a Repo</h3>
      <Switch>
        <Match when={mode().kind === "backendPending"}>
          <BackendPendingHint provider={props.provider} />
        </Match>
        <Match when={mode().kind === "notConnected"}>
          <NotConnectedCta
            provider={props.provider}
            onConnect={onConnectClicked}
          />
        </Match>
        <Match when={mode().kind === "connecting"}>
          <p class="dialog__field-hint">
            Connecting to {props.provider.label}…
          </p>
        </Match>
        <Match when={mode().kind === "connected"}>
          <ConnectedForm provider={props.provider} />
        </Match>
      </Switch>
    </div>
  );
}

function BackendPendingHint(props: { provider: ProviderInfo }) {
  return (
    <div class="clone-from-provider__pending">
      <p class="clone-from-provider__pending-title">
        {props.provider.label} backend is not yet implemented
      </p>
      <p class="dialog__field-hint">
        Repo enumeration for {props.provider.label} ships in a follow-up
        wave (tracked in #374). Use the <strong>Clone with URL</strong>{" "}
        tab in the meantime.
      </p>
    </div>
  );
}

function NotConnectedCta(props: {
  provider: ProviderInfo;
  onConnect: () => void;
}) {
  return (
    <div class="clone-from-provider__cta">
      <p class="clone-from-provider__cta-label">
        {props.provider.label} is not connected
      </p>
      <button
        class="dialog__btn dialog__btn--success"
        type="button"
        onClick={props.onConnect}
      >
        Connect to {props.provider.label}
      </button>
    </div>
  );
}

function ConnectedForm(props: { provider: ProviderInfo }) {
  const [picked, setPicked] = createSignal<CloneRepoCandidate | null>(null);
  const [query, setQuery] = createSignal("");
  const [dropdownOpen, setDropdownOpen] = createSignal(false);

  const [candidates] = createResource(
    () => props.provider.type,
    (type) => integrationListCloneCandidates(type),
  );

  const filtered = createMemo(() =>
    filterCandidates(candidates() ?? [], query()),
  );
  const groups = createMemo(() => groupCandidates(filtered()));

  const canSubmit = createMemo(
    () =>
      !cloneDialog.submitting() &&
      picked() !== null &&
      cloneDialog.parentPath().trim().length > 0,
  );

  async function pickParent() {
    const folder = await openPicker({
      directory: true,
      multiple: false,
      title: "Choose where to clone the repository",
    });
    if (typeof folder === "string") {
      cloneDialog.setParentPath(folder);
    }
  }

  function selectCandidate(c: CloneRepoCandidate) {
    setPicked(c);
    cloneDialog.setUrl(c.cloneUrlHttps);
    cloneDialog.setFolderName(c.name);
    cloneDialog.setFolderTouched(true);
    setQuery(c.fullName);
    setDropdownOpen(false);
  }

  function onSubmit() {
    if (!canSubmit()) return;
    void submitCloneDialog();
  }

  return (
    <>
      <div class="dialog__field">
        <label for="clone-parent-provider">Where to clone to</label>
        <div class="dialog__row">
          <input
            id="clone-parent-provider"
            type="text"
            value={cloneDialog.parentPath()}
            placeholder="/path/to/parent"
            disabled={cloneDialog.submitting()}
            onInput={(e) => cloneDialog.setParentPath(e.currentTarget.value)}
          />
          <button
            class="dialog__btn"
            type="button"
            disabled={cloneDialog.submitting()}
            onClick={() => void pickParent()}
          >
            Browse
          </button>
        </div>
      </div>

      <div class="dialog__field clone-from-provider__combobox">
        <label for="clone-repo-search">Repository to clone</label>
        <input
          id="clone-repo-search"
          type="text"
          placeholder="Search Remotes"
          value={query()}
          disabled={cloneDialog.submitting()}
          onFocus={() => setDropdownOpen(true)}
          onInput={(e) => {
            setQuery(e.currentTarget.value);
            setPicked(null);
            setDropdownOpen(true);
          }}
        />
        <Show when={dropdownOpen() && !candidates.loading}>
          <ul class="clone-from-provider__list" role="listbox">
            <Show
              when={groups().length > 0}
              fallback={
                <li class="clone-from-provider__empty">
                  {candidates.error
                    ? `Failed to load repos: ${String(candidates.error)}`
                    : query().trim().length > 0
                      ? `No matches for "${query().trim()}"`
                      : "No repositories accessible to this account."}
                </li>
              }
            >
              <For each={groups()}>
                {(group) => (
                  <li>
                    <div
                      class="clone-from-provider__group-header"
                      classList={{
                        "clone-from-provider__group-header--personal":
                          group.isPersonal,
                      }}
                    >
                      {group.headerLabel}
                    </div>
                    <ul class="clone-from-provider__group-rows">
                      <For each={group.rows}>
                        {(row) => (
                          <li
                            class="clone-from-provider__row"
                            classList={{
                              "clone-from-provider__row--selected":
                                picked()?.fullName === row.fullName,
                            }}
                            role="option"
                            aria-selected={picked()?.fullName === row.fullName}
                            onClick={() => selectCandidate(row)}
                          >
                            <span
                              class="clone-from-provider__lock"
                              aria-label={
                                row.isPrivate ? "Private repository" : "Public repository"
                              }
                              title={row.isPrivate ? "Private" : "Public"}
                            >
                              {row.isPrivate ? "🔒" : ""}
                            </span>
                            <span class="clone-from-provider__row-name">
                              {row.name}
                            </span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </li>
                )}
              </For>
            </Show>
          </ul>
        </Show>
        <Show when={candidates.loading}>
          <p class="dialog__field-hint">Loading repositories…</p>
        </Show>
      </div>

      <div class="dialog__field">
        <label for="clone-depth-provider">Shallow Clone (optional)</label>
        <input
          id="clone-depth-provider"
          type="number"
          min="1"
          value={cloneDialog.depth()}
          placeholder="full history"
          disabled={cloneDialog.submitting()}
          onInput={(e) => cloneDialog.setDepth(e.currentTarget.value)}
        />
      </div>

      <div class="dialog__field">
        <label class="dialog__checkbox">
          <input
            type="checkbox"
            checked={cloneDialog.recurseSubmodules()}
            disabled={cloneDialog.submitting()}
            onChange={(e) =>
              cloneDialog.setRecurseSubmodules(e.currentTarget.checked)
            }
          />
          Recurse submodules
        </label>
      </div>

      <Show when={cloneDialog.submitting()}>
        <ProgressBar
          label={phaseLabel(cloneDialog.progress()?.phase)}
          percent={cloneDialog.progress()?.percent ?? 0}
          current={cloneDialog.progress()?.current}
          total={cloneDialog.progress()?.total}
          indeterminate={!cloneDialog.progress()}
        />
      </Show>

      <Show when={cloneDialog.error()}>
        <p class="dialog__error">{cloneDialog.error()}</p>
      </Show>

      <div class="onboarding-dialog__panel-actions">
        <Show
          when={!cloneDialog.submitting()}
          fallback={
            <button
              class="dialog__btn dialog__btn--danger"
              type="button"
              onClick={() => void cancelCloneDialog()}
            >
              Cancel clone
            </button>
          }
        >
          <button
            class="dialog__btn dialog__btn--success"
            type="button"
            disabled={!canSubmit()}
            onClick={onSubmit}
          >
            Clone the repo!
          </button>
        </Show>
      </div>
    </>
  );
}
