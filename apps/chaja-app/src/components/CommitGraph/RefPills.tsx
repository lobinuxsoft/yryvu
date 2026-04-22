// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Per-commit ref pill group in the BRANCH/TAG column.
 *
 * 1:1 port of GitKraken's `ref-node` component per
 * `docs/research/gitkraken-graph/06-ref-pills.md`. Renders the first pill
 * inline plus a `+N` overflow chip that opens a popover listing the rest.
 * No lane-color tinting — pills use ref-type colors per doc 06's explicit
 * rule ("legitimate clone-scope correction: pills use ref-type colors, not
 * lane color").
 *
 * Deferred to follow-up (not in this first pass):
 * - Right-click context menu (checkout / rename / delete / pin-to-left) —
 *   requires lifting `useBranchOps` from LeftSidebar so CommitGraph can
 *   consume it.
 * - Upstream ahead/behind indicators — needs backend to emit tracking info
 *   per ref (separate plumbing).
 * - PR-attribution badge — soft-depends on #15 GH PR list landing.
 * - Hide-btn — not critical for initial clone visibility.
 */

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";

import {
  IconBranch,
  IconCheck,
  IconCloud,
  IconTag,
} from "../Icons";
import type { RefTag } from "../../ipc/commits";
import { clearHoveredRef, setHoveredRef } from "../../state";

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
 * Ordering within a commit's ref list (single "group" since they all share
 * the same commit). Doc 06 defines three-stage comparison:
 * 1. HEAD (checked-out) first.
 * 2. Type priority desc.
 * 3. Alphabetical by name.
 *
 * Pinned-branch priority (stage 2 in the full GitKraken algorithm) is
 * deferred — backend doesn't yet expose the pinned sha to the frontend.
 */
function orderRefs(refs: RefTag[]): RefTag[] {
  return [...refs].sort((a, b) => {
    // HEAD first.
    if (a.kind === "Head" && b.kind !== "Head") return -1;
    if (b.kind === "Head" && a.kind !== "Head") return 1;
    const p = typePriority(b.kind) - typePriority(a.kind);
    if (p !== 0) return p;
    return a.name.localeCompare(b.name);
  });
}

function pillClass(kind: RefTag["kind"]): string {
  switch (kind) {
    case "Head":
      return "ref-pill ref-pill--head";
    case "Branch":
      return "ref-pill ref-pill--branch";
    case "RemoteBranch":
      return "ref-pill ref-pill--remote";
    case "Tag":
      return "ref-pill ref-pill--tag";
  }
}

function PillIcon(props: { kind: RefTag["kind"] }) {
  switch (props.kind) {
    case "Head":
      // Checkmark annotation for the checked-out ref (doc 06 — annotation
      // sits at the far left of the pill, takes priority over the name).
      return <IconCheck class="ref-pill__icon" width={12} height={12} />;
    case "Branch":
      return <IconBranch class="ref-pill__icon" width={12} height={12} />;
    case "RemoteBranch":
      return <IconCloud class="ref-pill__icon" width={12} height={12} />;
    case "Tag":
      return <IconTag class="ref-pill__icon" width={12} height={12} />;
  }
}

function RefPill(props: { tag: RefTag; active?: boolean }) {
  // Hover / focus on a pill → register it as the hovered ref so the graph
  // dims non-ancestors. Uses `head` bucket for local branches AND the
  // HEAD ref itself (backend treats local-branch and head as the same
  // namespace in `child_refs.heads`).
  const enter = () =>
    setHoveredRef({
      kind: hoveredKindFor(props.tag.kind),
      name: props.tag.name,
    });
  return (
    <span
      class={pillClass(props.tag.kind)}
      classList={{ "is-active": props.active }}
      title={props.tag.name}
      tabIndex={0}
      onMouseEnter={enter}
      onMouseLeave={clearHoveredRef}
      onFocus={enter}
      onBlur={clearHoveredRef}
    >
      <PillIcon kind={props.tag.kind} />
      <span class="ref-pill__name">{props.tag.name}</span>
    </span>
  );
}

/**
 * Full per-row group. Renders the first pill inline; additional pills go
 * behind a `+N` chip that opens a popover on click.
 */
export function RefPillGroup(props: { refs: RefTag[] }) {
  const ordered = () => orderRefs(props.refs);
  const hasActive = () => ordered().some((r) => r.kind === "Head");

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
          active={ordered()[0].kind === "Head"}
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
              {(r) => <RefPill tag={r} />}
            </For>
          </div>
        </Show>
      </span>
    </Show>
  );
}
