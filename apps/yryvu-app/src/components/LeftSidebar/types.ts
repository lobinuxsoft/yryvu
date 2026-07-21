// SPDX-License-Identifier: AGPL-3.0-or-later

import type { MergeResult, RemoteInfo } from "../../ipc";
import type { ContextMenuItem } from "../ContextMenu";

export type MenuState = {
  x: number;
  y: number;
  items: ContextMenuItem[];
};

export type DialogState =
  | { kind: "create"; from?: string }
  | { kind: "rename"; oldName: string }
  | { kind: "delete"; name: string; unmerged?: boolean }
  | {
      kind: "checkout-dirty";
      target: string;
      /// `true` when `target` is a remote-tracking ref (`origin/feature-x`)
      /// and the resolved action should create-or-switch to a local
      /// tracking branch instead of plain switch (#222).
      remoteTracking?: boolean;
    }
  | { kind: "merge-pick"; source: string }
  | { kind: "merge-result"; result: MergeResult }
  | { kind: "delete-remote"; remote: string; name: string }
  | { kind: "submodule-add" }
  | { kind: "submodule-remove"; name: string; path: string }
  | { kind: "submodule-reset"; name: string; dirty: boolean }
  | { kind: "submodule-deinit"; name: string; path: string; dirty: boolean }
  | { kind: "set-upstream"; branchName: string; currentUpstream: string | null }
  | {
      /// Tag deletion — `scope` discriminates between local-only,
      /// single-remote, and all-remotes flows so the dialog body
      /// surfaces the right copy and the submitter routes to the
      /// right backend op.
      kind: "delete-tag";
      name: string;
      scope:
        | { type: "local" }
        | { type: "remote"; remote: string }
        | { type: "all-remotes"; remotes: string[] };
    }
  | { kind: "annotate-tag"; name: string }
  | { kind: "add-remote" }
  | {
      /// Edit a remote: name, fetch URL, push URL. Carries the whole
      /// `RemoteInfo` because the dialog needs the current values to
      /// seed its fields and to tell which ones actually changed.
      ///
      /// The name used to be immutable here, on the claim that libgit2
      /// had no single-call rename. It does — `remote_rename`, which
      /// also moves the tracking refs (#132).
      kind: "edit-remote";
      remote: RemoteInfo;
    }
  | { kind: "remove-remote"; name: string }
  | {
      /// Add a worktree (issue #20). Path + branch live in
      /// dialogPathInput / dialogNameInput; the create-branch toggle and
      /// base ref live in their own signals.
      kind: "worktree-add";
    }
  | {
      /// Confirm removing a worktree (issue #20). `dirty` drives the
      /// extra data-loss warning.
      kind: "worktree-remove";
      workdir: string;
      branch: string;
      dirty: boolean;
    }
  | {
      /// Git Flow / GitHub Flow start (issue #19). `flow` selects the
      /// topic kind; the name/version comes from `gitflowName`. GitHub
      /// Flow also reads `gitflowBase`.
      kind: "gitflow-start";
      flow: GitflowFlow;
    }
  | {
      /// Git Flow / GitHub Flow finish. `candidates` are the branches
      /// the user can pick to finish (topic branches matching the
      /// prefix, or every local branch for GitHub Flow).
      kind: "gitflow-finish";
      flow: GitflowFlow;
      candidates: string[];
    }
  | null;

/// Which workflow a gitflow dialog drives. `feature` / `release` /
/// `hotfix` are Git Flow; `github` is GitHub Flow (branch off a base,
/// merge back).
export type GitflowFlow = "feature" | "release" | "hotfix" | "github";
