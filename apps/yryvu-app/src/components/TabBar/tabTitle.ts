// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tab title resolution + filter matching. Shared between TabPill and
 * TabDropdown so a pill and the corresponding dropdown row always show
 * the same string — drift between the two would be a UX regression.
 *
 * `filterByTitle` is the dropdown's substring-match helper, factored
 * out so it stays pure + testable without a DOM.
 */

import { type Tab } from "../../tabs/types";

export function titleOf(tab: Tab): string {
  switch (tab.type) {
    case "REPO": {
      const seg = tab.repoPath.split("/").filter(Boolean).pop();
      return seg ?? "Repo";
    }
    case "NEW":
      return "New Tab";
    case "RELEASE_NOTES":
      return "Release Notes";
  }
}

/// Case-insensitive substring filter over an arbitrary list, with the
/// title resolved by the provided extractor. An empty / whitespace-only
/// query passes everything through (the dropdown shows the full list
/// when the input is empty).
export function filterByTitle<T>(
  items: T[],
  getTitle: (item: T) => string,
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return items;
  return items.filter((item) => getTitle(item).toLowerCase().includes(q));
}
