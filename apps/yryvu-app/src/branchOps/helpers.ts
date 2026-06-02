// SPDX-License-Identifier: AGPL-3.0-or-later

import type { RefTag } from "../ipc";
import type { SectionKey } from "../state";

/**
 * Stable key used to track hidden refs across reloads. Encodes both kind
 * and name because tags and branches share namespaces and the Hide action
 * targets a specific (kind, name) pair from the right-click menu.
 */
export function refKey(tag: { kind: RefTag["kind"]; name: string }): string {
  return `${tag.kind}/${tag.name}`;
}

/**
 * Display label for a section key in the visibility-checkbox group. Mirrors
 * GK's `getLeftPanelSectionTranslateString` (audit doc 10) — labels match
 * the section header text the user sees in the sidebar so the menu reads
 * unambiguously.
 */
export function sectionLabel(key: SectionKey): string {
  switch (key) {
    case "LOCAL":
      return "Local Branches";
    case "REMOTE":
      return "Remote Branches";
    case "WORKTREES":
      return "Worktrees";
    case "STASHES":
      return "Stashes";
    case "PULL_REQUESTS":
      return "Pull Requests";
    case "ISSUES":
      return "Issues";
    case "TAGS":
      return "Tags";
    case "SUBMODULES":
      return "Submodules";
    case "GITFLOW":
      return "Git Flow";
  }
}
