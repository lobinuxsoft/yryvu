// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Drop popover (issue #9). Mounted in `AppShell` once; renders only
 * when `dropPopover()` is set. Reuses `ContextMenu` for the visual
 * shell so it inherits keyboard nav + escape-to-close for free.
 *
 * Action dispatch lives here too — converting the abstract
 * `DropAction.id` into the matching IPC call. Failure handling routes
 * through the standard `notify` channel.
 */

import { Show, type JSX } from "solid-js";

import {
  cherryPickCommit,
  mergeBranch,
  rebaseCurrentOnto,
  resetToCommit,
  type ResetMode,
} from "../../ipc";
import {
  closeDropPopover,
  dropPopover,
  repoPath,
  refreshBranches,
  refreshGraph,
  type DragPayload,
  type DragTarget,
  type DropAction,
} from "../../state";
import { useBranchOps } from "../../branchOps";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { notify } from "../Notifications";

async function applyAction(
  action: DropAction,
  source: DragPayload,
  target: DragTarget,
  ops: { tryCheckout: (name: string) => Promise<void> },
): Promise<void> {
  const repo = repoPath();
  if (!repo) return;
  try {
    switch (action.id) {
      case "merge": {
        if (source.kind !== "ref") return;
        const result = await mergeBranch(repo, source.tag.name, "fast-forward-or-merge");
        notifyMerge(result);
        break;
      }
      case "fast-forward": {
        if (source.kind !== "ref") return;
        const result = await mergeBranch(repo, source.tag.name, "fast-forward-only");
        notifyMerge(result);
        break;
      }
      case "rebase-current-onto": {
        const onto = source.kind === "ref" ? source.tag.name : source.sha;
        await rebaseCurrentOnto(repo, onto);
        notify.success("Rebased current onto", {
          message: onto.length === 40 ? onto.slice(0, 7) : onto,
          category: "commit",
        });
        break;
      }
      case "cherry-pick": {
        const sha = source.kind === "commit" ? source.sha : source.sha;
        await cherryPickCommit(repo, sha);
        notify.success("Cherry-picked", {
          message: sha.slice(0, 7),
          category: "commit",
        });
        break;
      }
      case "reset-soft":
      case "reset-mixed":
      case "reset-hard": {
        if (target.kind !== "commit") return;
        const mode: ResetMode =
          action.id === "reset-soft"
            ? "soft"
            : action.id === "reset-mixed"
              ? "mixed"
              : "hard";
        await resetToCommit(repo, target.sha, mode);
        notify.info(`Reset (${mode})`, {
          message: target.sha.slice(0, 7),
          category: "commit",
        });
        break;
      }
      case "checkout": {
        if (source.kind === "ref") {
          await ops.tryCheckout(source.tag.name);
        }
        break;
      }
    }
  } catch (err) {
    notify.error(`${action.label} failed`, {
      message: String(err),
      category: "commit",
    });
  }
  refreshGraph();
  refreshBranches();
}

function notifyMerge(result: Awaited<ReturnType<typeof mergeBranch>>): void {
  switch (result.kind) {
    case "already-up-to-date":
      notify.info("Already up to date", { category: "commit" });
      break;
    case "fast-forward":
      notify.success("Fast-forwarded", {
        message: result.new_head.slice(0, 7),
        category: "commit",
      });
      break;
    case "merged":
      notify.success("Merged", {
        message: result.new_head.slice(0, 7),
        category: "commit",
      });
      break;
    case "conflict":
      notify.error("Merge conflict", {
        message: `${result.paths.length} file(s) conflicted`,
        category: "commit",
      });
      break;
  }
}

export function DropActionMenu(): JSX.Element {
  const ops = useBranchOps();
  return (
    <Show when={dropPopover()}>
      {(p) => {
        const items = (): ContextMenuItem[] => {
          const popup = p();
          const list: ContextMenuItem[] = popup.actions.map((a) => ({
            label: a.label,
            disabled: a.disabled,
            danger: a.danger,
            onSelect: () => void applyAction(a, popup.source, popup.target, ops),
          }));
          return list;
        };
        return (
          <ContextMenu
            x={p().x}
            y={p().y}
            items={items()}
            onClose={() => closeDropPopover()}
          />
        );
      }}
    </Show>
  );
}
