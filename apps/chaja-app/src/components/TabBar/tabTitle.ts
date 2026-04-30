// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tab title resolution. Shared between TabPill and TabDropdown so a
 * pill and the corresponding dropdown row always show the same string
 * — drift between the two would be a UX regression.
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
