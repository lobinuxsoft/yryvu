// SPDX-License-Identifier: AGPL-3.0-or-later

//! Pure helpers powering the GitLab merge form's project-policy
//! gating. Split from the JSX so the radio / squash / default-method
//! decisions can be tested without mounting the component or stubbing
//! Solid signals.

import type {
  MergeMethod,
  ProjectMergeMethod,
  ProjectSquashOption,
} from "../../ipc";

/// Per-project gating: which method radios the GitLab project allows.
/// `merge` enables all three; `rebaseMerge` and `ff` forbid the
/// "Create a merge commit" radio (those policies require rebased /
/// linear history server-side).
export function methodAllowed(
  setting: ProjectMergeMethod,
  method: MergeMethod,
): boolean {
  if (method === "merge") return setting === "merge";
  return true;
}

/// Hint text shown beneath the radio strip explaining the active
/// project policy. Stays declarative — no GitLab API jargon, the user
/// just learns why a radio is greyed out.
export function mergeMethodHint(setting: ProjectMergeMethod): string {
  switch (setting) {
    case "merge":
      return "Project allows merge commits, squash, and rebase.";
    case "rebaseMerge":
      return 'Project requires rebase before merge — "Create a merge commit" is disabled.';
    case "ff":
      return 'Project is fast-forward only — "Create a merge commit" is disabled.';
  }
}

export interface SquashState {
  visible: boolean;
  locked: boolean;
  defaultChecked: boolean;
}

/// Squash checkbox availability per project policy. `never` hides it,
/// `always` shows it locked-checked, the `default*` options leave it
/// toggleable with the appropriate initial value.
export function squashState(option: ProjectSquashOption): SquashState {
  switch (option) {
    case "never":
      return { visible: false, locked: true, defaultChecked: false };
    case "always":
      return { visible: true, locked: true, defaultChecked: true };
    case "defaultOff":
      return { visible: true, locked: false, defaultChecked: false };
    case "defaultOn":
      return { visible: true, locked: false, defaultChecked: true };
  }
}

/// Pick the first method radio the project allows so the form opens
/// on a valid choice instead of a disabled one.
export function defaultMethod(setting: ProjectMergeMethod): MergeMethod {
  if (methodAllowed(setting, "merge")) return "merge";
  return "rebase";
}
