// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

import { STORAGE_PREFIX } from "./storage";

/// LeftPanel section identity. Mirrors GK's HEADER_KEYS (audit doc 00),
/// minus CLOUD_PATCHES, TEAM_VISIBILITY, FOCUS_VIEW (proprietary), and
/// GITFLOW (deferred — low priority). Used as the unit for hide /
/// expand / maximize state.
export type SectionKey =
  | "LOCAL"
  | "REMOTE"
  | "WORKTREES"
  | "STASHES"
  | "PULL_REQUESTS"
  | "ISSUES"
  | "TAGS"
  | "SUBMODULES";

export const ALL_SECTION_KEYS: readonly SectionKey[] = [
  "LOCAL",
  "REMOTE",
  "WORKTREES",
  "STASHES",
  "PULL_REQUESTS",
  "ISSUES",
  "TAGS",
  "SUBMODULES",
];

/// LOCAL is always visible — GK gates the visibility checkbox to
/// "disabled" so the user can't lose the only section that can never
/// be empty. (GITFLOW would also be disabled, but it isn't shipped.)
export const ALWAYS_VISIBLE_SECTION_KEYS: readonly SectionKey[] = ["LOCAL"];

const HIDDEN_SECTIONS_KEY = `${STORAGE_PREFIX}hiddenSections`;
const EXPANDED_SECTIONS_KEY = `${STORAGE_PREFIX}expandedSections`;

function loadSectionKeySet(storageKey: string): Set<SectionKey> {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return new Set<SectionKey>();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<SectionKey>();
    return new Set<SectionKey>(
      parsed.filter((v): v is SectionKey =>
        ALL_SECTION_KEYS.includes(v as SectionKey),
      ),
    );
  } catch {
    return new Set<SectionKey>();
  }
}

function persistSectionKeySet(storageKey: string, value: Set<SectionKey>): void {
  localStorage.setItem(storageKey, JSON.stringify(Array.from(value)));
}

const [hiddenSectionsInternal, setHiddenSectionsInternal] = createSignal<
  Set<SectionKey>
>(loadSectionKeySet(HIDDEN_SECTIONS_KEY));

const [expandedSectionsInternal, setExpandedSectionsInternal] = createSignal<
  Set<SectionKey>
>(
  loadSectionKeySet(EXPANDED_SECTIONS_KEY).size > 0
    ? loadSectionKeySet(EXPANDED_SECTIONS_KEY)
    : new Set<SectionKey>(["LOCAL"]),
);

export const hiddenSections = hiddenSectionsInternal;
export const expandedSections = expandedSectionsInternal;

/// Toggle whether `key` is collapsed. Used by the section header click
/// handler. Persists across restarts.
export function toggleSectionExpanded(key: SectionKey): void {
  const next = new Set(expandedSectionsInternal());
  if (next.has(key)) next.delete(key);
  else next.add(key);
  persistSectionKeySet(EXPANDED_SECTIONS_KEY, next);
  setExpandedSectionsInternal(next);
}

/// Collapse every section except `key`, expand `key`. Used by the
/// section header context menu's "Maximize this section" entry. The
/// previous expansion state is overwritten — the user gets it back by
/// expanding sections individually after.
export function maximizeSection(key: SectionKey): void {
  const next = new Set<SectionKey>([key]);
  persistSectionKeySet(EXPANDED_SECTIONS_KEY, next);
  setExpandedSectionsInternal(next);
}

/// Toggle whether `key` is in the hidden set. ALWAYS_VISIBLE_SECTION_KEYS
/// can't be hidden — calling this on one of them is a no-op so callers
/// don't need to gate at every site.
export function toggleSectionHidden(key: SectionKey): void {
  if (ALWAYS_VISIBLE_SECTION_KEYS.includes(key)) return;
  const next = new Set(hiddenSectionsInternal());
  if (next.has(key)) next.delete(key);
  else next.add(key);
  persistSectionKeySet(HIDDEN_SECTIONS_KEY, next);
  setHiddenSectionsInternal(next);
}
