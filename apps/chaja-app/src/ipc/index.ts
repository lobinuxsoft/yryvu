// SPDX-License-Identifier: AGPL-3.0-or-later

//! Public IPC surface for the frontend. Re-exports each domain module so
//! callers can keep `import { ... } from "../ipc"` without caring how the
//! internals are organised.

export * from "./branches";
export * from "./commits";
export * from "./diff";
export * from "./merge";
export * from "./preferences";
export * from "./release_notes";
export * from "./remote";
export * from "./repo_management";
export * from "./smart_branches";
export * from "./staging";
export * from "./stashes";
export * from "./submodules";
export * from "./tags";
export * from "./undo";
export * from "./worktree";
export * from "./worktrees";
