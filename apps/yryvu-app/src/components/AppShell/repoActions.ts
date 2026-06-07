// SPDX-License-Identifier: AGPL-3.0-or-later

import { open } from "@tauri-apps/plugin-dialog";

import { pushRecentRepo, setRepoPath } from "../../state";
import { openRepoInAnotherTab } from "../../tabs/ops";

/// Native folder picker → open the selected repo. Shared by the toolbar
/// "Open repo" button and the `menu:open-repo` listener.
export async function openRepoPicker(): Promise<void> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: "Open a Git repository",
  });
  if (typeof selected === "string") {
    pushRecentRepo(selected);
    setRepoPath(selected);
    // Also create or switch to a REPO tab for the picked path. The ops
    // layer dedupes via switchToRepoTabIfItExists so picking a path
    // that's already open just switches to its existing tab.
    void openRepoInAnotherTab(selected);
  }
}
