// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BranchInfo, ResetMode, TagInfo } from "../../ipc";
import type { MenuState } from "../../components/LeftSidebar/types";

/**
 * Wide-but-explicit dependency surface every menu builder picks from.
 * Each `menus/<x>.tsx` only consumes the keys it needs — TS will let
 * you forget one, but at the cost of a clearer compile error than a
 * silent closure capture would give us.
 *
 * The two `*Source` fields are getters because the LeftSidebar wires
 * them in onMount (after the resources mount); reading them eagerly
 * would freeze the menu against stale `undefined`s.
 */
export interface MenuDeps {
  setMenu: (m: MenuState | null) => void;

  // handlers
  tryCheckout: (target: string) => Promise<void>;
  tryCheckoutRemoteTracking: (fullRemoteName: string) => Promise<void>;
  doRebaseCurrentOnto: (target: string) => Promise<void>;
  doPullCurrent: () => Promise<void>;
  doPushCurrent: () => Promise<void>;
  doResetTo: (sha: string, mode: ResetMode) => Promise<void>;

  // dialog openers
  openMergePickDialog: (source: string) => void;
  openCreateDialog: (from?: string) => void;
  openRenameDialog: (oldName: string) => void;
  openDeleteDialog: (name: string) => void;
  openDeleteRemoteDialog: (remote: string, name: string) => void;
  openSubmoduleRemoveDialog: (name: string, path: string) => void;
  openSetUpstreamDialog: (
    branchName: string,
    currentUpstream: string | null,
  ) => void;

  // section-menu data sources (set by LeftSidebar onMount)
  branchSource: () => BranchInfo[] | undefined;
  tagSource: () => TagInfo[] | undefined;
  /// List of configured remote names. Tag menu uses it to render
  /// per-remote Push / Delete entries; section menu may use it later.
  remotesSource: () => string[] | undefined;

  // tag-menu specific openers / handlers
  openDeleteTagDialog: (
    name: string,
    scope:
      | { type: "local" }
      | { type: "remote"; remote: string }
      | { type: "all-remotes"; remotes: string[] },
  ) => void;
  openAnnotateTagDialog: (name: string) => void;
  pushTagTo: (remote: string, name: string) => Promise<void>;
  tryCheckoutTagSha: (tagName: string, sha: string) => Promise<void>;

  // remote-header-menu specific openers / handlers (#227)
  openAddRemoteDialog: () => void;
  openEditRemoteDialog: (name: string, currentUrl: string) => void;
  openRemoveRemoteDialog: (name: string) => void;
  fetchRemote: (remote: string) => Promise<void>;
  refreshRemote: () => Promise<void>;
}
