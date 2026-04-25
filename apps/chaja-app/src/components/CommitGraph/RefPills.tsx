// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Per-commit ref pill group in the BRANCH/TAG column.
 *
 * 1:1 port of GitKraken's `ref-node` component per
 * `docs/research/gitkraken-graph/06-ref-pills.md`. Composite anatomy
 * `[annotation][icon-L][name][upstream]` driven by the RefTag payload,
 * with stage-1 (HEAD), stage-2 (pinned) and stage-3 (type / alpha)
 * ordering. Renders the first pill inline plus a `+N` overflow chip
 * that opens a popover listing the rest.
 *
 * Deferred to follow-up (Fase 3 of issue #145):
 * - Right-click context menu (checkout / rename / delete / pin / hide).
 *   Requires lifting `useBranchOps` from LeftSidebar so CommitGraph can
 *   consume it.
 * - Hide-btn (hover-only). Backed by a `hiddenRefs` persisted set —
 *   coupled to the context menu hide entry so they ship together.
 * - PR-attribution badge (icons-R slot). Soft-depends on #15 GitHub PR
 *   list landing.
 */

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";

import {
  IconBranch,
  IconCheck,
  IconClose,
  IconCloud,
  IconPin,
  IconTag,
} from "../Icons";
import type { RefTag } from "../../ipc/commits";
import {
  clearHoveredRef,
  hiddenRefs,
  pinnedSha,
  setHiddenRef,
  setHoveredRef,
} from "../../state";
import { refKey, useBranchOps } from "../../branchOps";

/**
 * Map a ref-tag `kind` (backend enum) to the `HoveredRef.kind` channel used
 * by the hover-dim pass. The backend splits remote branches and tags into
 * their own buckets; the dim test indexes by these three buckets.
 */
function hoveredKindFor(kind: RefTag["kind"]): "head" | "remote" | "tag" {
  switch (kind) {
    case "Head":
    case "Branch":
      return "head";
    case "RemoteBranch":
      return "remote";
    case "Tag":
      return "tag";
  }
}

/**
 * Type priority for ordering within a row — higher sorts first.
 * Matches doc 06: WORKTREE(3) > HEAD(2) > REMOTE(1) > TAG(0). Local Branch
 * co-equal with Head at 2 since we don't have a separate worktree kind.
 */
function typePriority(kind: RefTag["kind"]): number {
  switch (kind) {
    case "Head":
      return 3;
    case "Branch":
      return 2;
    case "RemoteBranch":
      return 1;
    case "Tag":
      return 0;
  }
}

/**
 * Three-stage ordering per doc 06:
 *   1. HEAD (checked-out) first.
 *   2. Pinned-branch group next — only applies on the pinned row, where
 *      the local branch matching the pinned head sha is promoted.
 *   3. Type priority desc, then alphabetical by name.
 *
 * `pinnedRow` indicates the call-site already verified the row's sha
 * matches the global `pinnedSha`; otherwise stage 2 is a no-op.
 */
function orderRefs(refs: RefTag[], pinnedRow: boolean): RefTag[] {
  return [...refs].sort((a, b) => {
    if (a.kind === "Head" && b.kind !== "Head") return -1;
    if (b.kind === "Head" && a.kind !== "Head") return 1;
    if (pinnedRow) {
      // The local branch on the pinned row outranks any other non-HEAD ref.
      // Tags / remotes on the same commit fall to stage 3.
      if (a.kind === "Branch" && b.kind !== "Branch") return -1;
      if (b.kind === "Branch" && a.kind !== "Branch") return 1;
    }
    const p = typePriority(b.kind) - typePriority(a.kind);
    if (p !== 0) return p;
    return a.name.localeCompare(b.name);
  });
}

function pillKindClass(kind: RefTag["kind"]): string {
  switch (kind) {
    case "Head":
      return "ref-pill--head";
    case "Branch":
      return "ref-pill--branch";
    case "RemoteBranch":
      return "ref-pill--remote";
    case "Tag":
      return "ref-pill--tag";
  }
}

function PillKindIcon(props: { kind: RefTag["kind"] }) {
  switch (props.kind) {
    case "Head":
      // HEAD's annotation slot already carries the checkmark — the icon
      // slot reuses the local-branch glyph for visual consistency.
      return <IconBranch class="ref-pill__icon" width={12} height={12} />;
    case "Branch":
      return <IconBranch class="ref-pill__icon" width={12} height={12} />;
    case "RemoteBranch":
      return <IconCloud class="ref-pill__icon" width={12} height={12} />;
    case "Tag":
      return <IconTag class="ref-pill__icon" width={12} height={12} />;
  }
}

interface RefPillProps {
  tag: RefTag;
  sha: string;
  active?: boolean;
  pinned?: boolean;
  /** When true, suppress the hide-btn slot (matches GK's `!hasActive` gate). */
  suppressHide?: boolean;
}

function RefPill(props: RefPillProps) {
  const ops = useBranchOps();
  const enter = () =>
    setHoveredRef({
      kind: hoveredKindFor(props.tag.kind),
      name: props.tag.name,
    });
  const hide = (e: MouseEvent) => {
    e.stopPropagation();
    setHiddenRef(refKey(props.tag), true);
  };
  // The annotation slot is mutually exclusive — checkmark when this pill is
  // the active (HEAD-aliased) ref; otherwise pin when this pill represents
  // the trunk's local branch.
  return (
    <span
      class="ref-pill"
      classList={{
        [pillKindClass(props.tag.kind)]: true,
        "is-active": props.active,
        "is-pinned": props.pinned && !props.active,
      }}
      title={props.tag.name}
      tabIndex={0}
      onMouseEnter={enter}
      onMouseLeave={clearHoveredRef}
      onFocus={enter}
      onBlur={clearHoveredRef}
      onContextMenu={(e) => ops.openRefContextMenu(e, props.tag, props.sha)}
    >
      <Show when={props.active}>
        <IconCheck class="ref-pill__annotation" width={12} height={12} />
      </Show>
      <Show when={props.pinned && !props.active}>
        <IconPin class="ref-pill__annotation" width={12} height={12} />
      </Show>
      <PillKindIcon kind={props.tag.kind} />
      <span class="ref-pill__name">{props.tag.name}</span>
      <Show when={props.tag.upstream && (props.tag.ahead > 0 || props.tag.behind > 0)}>
        <span
          class="ref-pill__upstream"
          title={`Tracks ${props.tag.upstream} (${props.tag.ahead} ahead, ${props.tag.behind} behind)`}
        >
          <Show when={props.tag.ahead > 0}>
            <span class="ref-pill__ahead">↑{props.tag.ahead}</span>
          </Show>
          <Show when={props.tag.behind > 0}>
            <span class="ref-pill__behind">↓{props.tag.behind}</span>
          </Show>
        </span>
      </Show>
      <Show when={!props.suppressHide && props.tag.kind !== "Head"}>
        <button
          type="button"
          class="ref-pill__hide-btn"
          title={`Hide '${props.tag.name}'`}
          aria-label={`Hide ${props.tag.name}`}
          onClick={hide}
        >
          <IconClose width={10} height={10} />
        </button>
      </Show>
    </span>
  );
}

/**
 * Full per-row group. Renders the first pill inline; additional pills go
 * behind a `+N` chip that opens a popover on click.
 *
 * `sha` is the row's commit sha — compared against the global `pinnedSha`
 * signal to decide whether stage-2 ordering applies and whether the
 * pinned annotation renders on the local-branch pill.
 */
export function RefPillGroup(props: { refs: RefTag[]; sha: string }) {
  const isPinnedRow = () => pinnedSha() === props.sha;
  // Filter out user-hidden refs before ordering — GK matches behaviour:
  // hidden pills disappear from the row entirely, available again only via
  // the `Show all hidden refs` action (deferred, follow-up issue).
  const visibleRefs = () =>
    props.refs.filter((r) => !hiddenRefs().has(refKey(r)));
  const ordered = () => orderRefs(visibleRefs(), isPinnedRow());
  const hasActive = () => ordered().some((r) => r.kind === "Head");
  // Stage-2 only annotates the *first* local-branch pill on the pinned row
  // — there's exactly one, but if a row carried multiple local branches
  // the pin would still belong to the trunk-aliased one (already first
  // post-orderRefs when `pinnedRow=true`).
  const isPinnedPill = (tag: RefTag, idx: number) => {
    if (!isPinnedRow()) return false;
    if (tag.kind !== "Branch") return false;
    return ordered().findIndex((r) => r.kind === "Branch") === idx;
  };

  const [popoverOpen, setPopoverOpen] = createSignal(false);
  let rootEl: HTMLSpanElement | undefined;

  // Close popover on outside click / Escape. Also close if the ref list
  // changes while the popover is open (e.g. user switched commits).
  createEffect(() => {
    if (!popoverOpen()) return;

    const onDocClick = (e: MouseEvent) => {
      if (rootEl && !rootEl.contains(e.target as Node)) setPopoverOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopoverOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    });
  });

  return (
    <Show when={ordered().length > 0}>
      <span
        class="ref-node"
        classList={{ "has-active": hasActive() }}
        ref={(el) => (rootEl = el)}
      >
        <RefPill
          tag={ordered()[0]}
          sha={props.sha}
          active={ordered()[0].kind === "Head"}
          pinned={isPinnedPill(ordered()[0], 0)}
          suppressHide={hasActive()}
        />
        <Show when={ordered().length > 1}>
          <button
            type="button"
            class="ref-node__overflow"
            classList={{ "is-active": hasActive() }}
            onClick={(e) => {
              e.stopPropagation();
              setPopoverOpen((o) => !o);
            }}
            title={`${ordered().length - 1} more ref${ordered().length - 1 === 1 ? "" : "s"}`}
          >
            +{ordered().length - 1}
          </button>
        </Show>
        <Show when={popoverOpen()}>
          <div class="ref-node__popover" onClick={(e) => e.stopPropagation()}>
            <For each={ordered().slice(1)}>
              {(r, i) => (
                <RefPill
                  tag={r}
                  sha={props.sha}
                  pinned={isPinnedPill(r, i() + 1)}
                  suppressHide={hasActive()}
                />
              )}
            </For>
          </div>
        </Show>
      </span>
    </Show>
  );
}
