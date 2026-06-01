// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ContextMenuItem } from "../../components/ContextMenu";
import {
  ALL_SECTION_KEYS,
  ALWAYS_VISIBLE_SECTION_KEYS,
  hiddenRefs,
  hiddenSections,
  maximizeSection,
  setHiddenRef,
  toggleSectionHidden,
  type SectionKey,
} from "../../state";
import { refKey, sectionLabel } from "../helpers";
import { buildGithubFlowMenuItems, resolveGithubFlowBase } from "./gitflow";
import type { MenuDeps } from "./types";

/**
 * Right-click menu for a section header in the LeftPanel (#220).
 * Builds the three-group GK shape from audit doc 10:
 *
 *   1. Hide all / Show all   — only LOCAL / REMOTE / TAGS surfaces
 *      have a ref-level "hidden" concept that maps cleanly. STASHES
 *      gets it in a follow-up (chajá lacks a hideAllStashes API).
 *   2. Maximize this section — collapses every other section, expands
 *      this one full-height. Persisted across restarts.
 *   3. Visibility checkboxes — every section keyed in ALL_SECTION_KEYS,
 *      with a ✓ prefix when visible. LOCAL is always-on (audit doc 00),
 *      so its row is disabled.
 *
 * The pure-builder split lets the REMOTE-header menu (#227) compose
 * these items underneath its own remote-management entries without
 * duplicating the three-group logic.
 */
export function buildSectionMenuItems(
  deps: MenuDeps,
  key: SectionKey,
): ContextMenuItem[] {
  const items: ContextMenuItem[] = [];
  const branchSrc = deps.branchSource();
  const tagSrc = deps.tagSource();

  // ---- Group 1: Hide all / Show all (LOCAL / REMOTE / TAGS) -----
  if (key === "LOCAL" && branchSrc) {
    const locals = branchSrc.filter((b) => b.kind === "local");
    const localKeys = locals.map((b) =>
      refKey({ kind: "Branch", name: b.name }),
    );
    const someShown = localKeys.some((k) => !hiddenRefs().has(k));
    const someHidden = localKeys.some((k) => hiddenRefs().has(k));
    items.push({
      label: "Hide all local branches",
      disabled: !someShown,
      onSelect: () => localKeys.forEach((k) => setHiddenRef(k, true)),
    });
    items.push({
      label: "Show all local branches",
      disabled: !someHidden,
      onSelect: () => localKeys.forEach((k) => setHiddenRef(k, false)),
    });
    items.push({ type: "separator" });
    // GitHub Flow lives here (not the GITFLOW section) so it's reachable
    // without a `[gitflow]` config — issue #19.
    const base = resolveGithubFlowBase(
      deps.gitflowConfigSource(),
      locals.map((b) => b.name),
    );
    items.push(...buildGithubFlowMenuItems(deps, base));
    items.push({ type: "separator" });
  } else if (key === "REMOTE" && branchSrc) {
    const remoteKeys = branchSrc
      .filter((b) => b.kind === "remote")
      .map((b) => refKey({ kind: "RemoteBranch", name: b.name }));
    const someShown = remoteKeys.some((k) => !hiddenRefs().has(k));
    const someHidden = remoteKeys.some((k) => hiddenRefs().has(k));
    items.push({
      label: "Hide all remote branches",
      disabled: !someShown,
      onSelect: () => remoteKeys.forEach((k) => setHiddenRef(k, true)),
    });
    items.push({
      label: "Show all remote branches",
      disabled: !someHidden,
      onSelect: () => remoteKeys.forEach((k) => setHiddenRef(k, false)),
    });
    items.push({ type: "separator" });
  } else if (key === "TAGS" && tagSrc) {
    const tagKeys = tagSrc.map((t) => refKey({ kind: "Tag", name: t.name }));
    const someShown = tagKeys.some((k) => !hiddenRefs().has(k));
    const someHidden = tagKeys.some((k) => hiddenRefs().has(k));
    items.push({
      label: "Hide all tags",
      disabled: !someShown,
      onSelect: () => tagKeys.forEach((k) => setHiddenRef(k, true)),
    });
    items.push({
      label: "Show all tags",
      disabled: !someHidden,
      onSelect: () => tagKeys.forEach((k) => setHiddenRef(k, false)),
    });
    items.push({ type: "separator" });
  }

  // ---- Group 2: Maximize -----------------------------------------
  items.push({
    label: "Maximize this section",
    onSelect: () => maximizeSection(key),
  });
  items.push({ type: "separator" });

  // ---- Group 3: Per-section visibility ---------------------------
  // Use a leading ✓ prefix for visible sections, ' ' (em space) for
  // hidden — keeps the alignment readable in mono-fallback fonts and
  // doesn't depend on a checkbox menu type the renderer doesn't have.
  for (const sk of ALL_SECTION_KEYS) {
    const isVisible = !hiddenSections().has(sk);
    const isAlwaysOn = ALWAYS_VISIBLE_SECTION_KEYS.includes(sk);
    const prefix = isVisible ? "✓ " : "  ";
    items.push({
      label: `${prefix}${sectionLabel(sk)}`,
      disabled: isAlwaysOn,
      onSelect: () => toggleSectionHidden(sk),
    });
  }

  return items;
}

export function openSectionContextMenu(
  deps: MenuDeps,
  e: MouseEvent,
  key: SectionKey,
) {
  e.preventDefault();
  deps.setMenu({
    x: e.clientX,
    y: e.clientY,
    items: buildSectionMenuItems(deps, key),
  });
}
