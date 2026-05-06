// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

export interface InitRepositoryArgs {
  path: string;
  branchName: string;
  gitignoreTemplate?: string;
  licenseTemplate?: string;
  initializeFirstCommit: boolean;
  bare: boolean;
}

/// Returns the canonical path of the initialized repository.
export async function initRepository(args: InitRepositoryArgs): Promise<string> {
  return invoke<string>("init_repository", {
    path: args.path,
    branchName: args.branchName,
    gitignoreTemplate: args.gitignoreTemplate,
    licenseTemplate: args.licenseTemplate,
    initializeFirstCommit: args.initializeFirstCommit,
    bare: args.bare,
  });
}
