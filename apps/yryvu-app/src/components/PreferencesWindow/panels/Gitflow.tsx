// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  Show,
  Suspense,
  createEffect,
  createResource,
  createSignal,
  type JSX,
} from "solid-js";

import {
  gitflowDefaults,
  readGitflowConfig,
  writeGitflowConfig,
  type GitflowConfig,
} from "../../../ipc";
import { repoPath } from "../../../state";

type FieldKey = keyof GitflowConfig;

const LONG_LIVED_FIELDS: ReadonlyArray<{ key: FieldKey; label: string }> = [
  { key: "masterBranch", label: "Production branch" },
  { key: "developBranch", label: "Integration branch" },
];

const PREFIX_FIELDS: ReadonlyArray<{ key: FieldKey; label: string }> = [
  { key: "featurePrefix", label: "Feature prefix" },
  { key: "releasePrefix", label: "Release prefix" },
  { key: "hotfixPrefix", label: "Hotfix prefix" },
  { key: "bugfixPrefix", label: "Bugfix prefix" },
  { key: "supportPrefix", label: "Support prefix" },
  { key: "versionTagPrefix", label: "Version tag prefix" },
];

/**
 * Git Flow preferences panel (issue #305).
 *
 * Per-repo state lives in `.git/config [gitflow]`. The panel reads on
 * mount / repo change and shows two states:
 *
 * 1. **Not initialised** — repo has no `[gitflow]` keys. Inputs
 *    pre-fill with the canonical defaults (`main` / `develop` /
 *    `feature/` etc.) and the call to action is "Initialize gitflow"
 *    which writes the whole block.
 * 2. **Initialised** — repo has existing values. Inputs reflect them;
 *    the call to action becomes "Save". Field edits keep a local
 *    signal until save so the user can cancel a typo.
 *
 * Branch context-menu actions ("Start Feature / Release / Hotfix")
 * are out of scope here — they belong with the workflow-ops issue
 * outside Preferences.
 */
export function GitflowPanel(): JSX.Element {
  const [existing, { refetch }] = createResource<
    GitflowConfig | null,
    string
  >(
    () => repoPath(),
    async (path) => {
      try {
        return await readGitflowConfig(path);
      } catch (err) {
        console.error("readGitflowConfig failed:", err);
        return null;
      }
    },
  );

  const [defaults] = createResource<GitflowConfig>(async () => {
    try {
      return await gitflowDefaults();
    } catch (err) {
      console.error("gitflowDefaults failed:", err);
      return {
        masterBranch: "main",
        developBranch: "develop",
        featurePrefix: "feature/",
        releasePrefix: "release/",
        hotfixPrefix: "hotfix/",
        bugfixPrefix: "bugfix/",
        supportPrefix: "support/",
        versionTagPrefix: "v",
      };
    }
  });

  // One local string signal per field. Re-seeded whenever the repo
  // changes (existing values win; fall back to defaults).
  const [form, setForm] = createSignal<GitflowConfig | null>(null);
  const [saving, setSaving] = createSignal(false);

  createEffect(() => {
    const ex = existing();
    const def = defaults();
    if (ex !== undefined) {
      setForm(ex ?? def ?? null);
    }
  });

  const setField = (key: FieldKey, value: string) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const onSave = async () => {
    const path = repoPath();
    const draft = form();
    if (!path || !draft) return;
    setSaving(true);
    try {
      await writeGitflowConfig(path, draft);
      await refetch();
    } catch (err) {
      console.error("writeGitflowConfig failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const ready = () => repoPath() !== undefined && form() !== null;
  const isInitialised = () => existing() !== null && existing() !== undefined;

  return (
    <div class="preferences__section-body">
      <h3 class="preferences__section-title">Git Flow</h3>
      <p class="ui-panel__helper">
        Vincent Driessen's branching model — long-lived production +
        integration branches, plus per-purpose topic-branch prefixes.
        Stored in this repo's <code>.git/config</code> under{" "}
        <code>[gitflow]</code>.
      </p>

      <Show
        when={repoPath() !== undefined}
        fallback={
          <p class="ui-panel__helper">
            Open a repository to configure or initialize Git Flow for it.
          </p>
        }
      >
        <Suspense fallback={<p class="ui-panel__helper">Loading config…</p>}>
          <Show when={form() !== null}>
            <h4 class="preferences__section-title gitflow-panel__sub-heading">
              Long-lived branches
            </h4>
            <FieldList
              fields={LONG_LIVED_FIELDS}
              get={(k) => form()?.[k] ?? ""}
              set={setField}
              disabled={!ready() || saving()}
            />

            <h4 class="preferences__section-title gitflow-panel__sub-heading">
              Topic-branch prefixes
            </h4>
            <FieldList
              fields={PREFIX_FIELDS}
              get={(k) => form()?.[k] ?? ""}
              set={setField}
              disabled={!ready() || saving()}
            />

            <div class="ui-panel__actions gitflow-panel__sub-heading">
              <button
                type="button"
                class="ui-panel__btn"
                onClick={() => void onSave()}
                disabled={!ready() || saving()}
              >
                {saving()
                  ? "Saving…"
                  : isInitialised()
                    ? "Save"
                    : "Initialize Git Flow"}
              </button>
            </div>
          </Show>
        </Suspense>
      </Show>
    </div>
  );
}

function FieldList(props: {
  fields: ReadonlyArray<{ key: FieldKey; label: string }>;
  get: (key: FieldKey) => string;
  set: (key: FieldKey, value: string) => void;
  disabled: boolean;
}) {
  return (
    <div class="gitflow-panel__rows">
      {props.fields.map((row) => (
        <div class="gitflow-panel__field">
          <label class="ui-panel__label" for={`gitflow-${row.key}`}>
            {row.label}
          </label>
          <input
            id={`gitflow-${row.key}`}
            class="tools-panel__input"
            type="text"
            value={props.get(row.key)}
            disabled={props.disabled}
            onInput={(e) => props.set(row.key, e.currentTarget.value)}
          />
        </div>
      ))}
    </div>
  );
}
