// SPDX-License-Identifier: AGPL-3.0-or-later

//! Public IPC surface for the frontend. Re-exports each domain module so
//! callers can keep `import { ... } from "../ipc"` without caring how the
//! internals are organised.

export * from "./branches";
export * from "./cliImport";
export * from "./clone";
export * from "./commits";
export * from "./integrationStorage";
export * from "./pr_detail";
export * from "./diff";
export * from "./gitflow";
export * from "./hooks";
export * from "./init";
export * from "./issue_tracker";
export * from "./merge";
export * from "./preferences";
export * from "./rebase";
export * from "./release_notes";
export * from "./remote";
export * from "./repo_management";
export * from "./smart_branches";
export * from "./sparse_checkout";
export * from "./staging";
export * from "./stashes";
export * from "./submodules";
export * from "./tags";
export * from "./templates";
export * from "./themes";
export * from "./undo";
export * from "./validate";
export * from "./worktree";
export * from "./worktrees";
