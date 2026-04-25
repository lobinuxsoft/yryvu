// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Per-commit ref pill group in the BRANCH/TAG column.
 *
 * 1:1 port of GitKraken's `ref-node` component per
 * `docs/research/gitkraken-graph/06-ref-pills.md`.
 *
 * Composite anatomy (left → right):
 *   `[annotation] [icon-L] [name] [icon-R: monitor + cloud] [upstream] [hide-btn]`
 *
 * Three ordering stages: HEAD → pinned-trunk → type/alpha. Overflow refs
 * collapse into a `+N` chip that opens a hover-delayed popover (matches
 * the bundle's `OverlayTrigger` 250 ms hover behaviour). When the row is
 * hovered, additional ghost pills surface for refs that pass through
 * this commit but aren't tipped here (`child_refs`) — gated by the GK
 * `showGhostRefsOnRowHover` setting.
 */

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";

import {
  IconBranch,
  IconCheck,
  IconClose,
  IconCloud,
  IconMonitor,
  IconPin,
  IconTag,
} from "../Icons";
import type { ChildRefs, RefTag } from "../../ipc/commits";
import {
  clearHoveredRef,
  hiddenRefs,
  pinnedSha,
  setHiddenRef,
  setHoveredRef,
  staleRefs,
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
 */
function orderRefs(refs: RefTag[], pinnedRow: boolean): RefTag[] {
  return [...refs].sort((a, b) => {
    if (a.kind === "Head" && b.kind !== "Head") return -1;
    if (b.kind === "Head" && a.kind !== "Head") return 1;
    if (pinnedRow) {
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
    case "Branch":
      return <IconBranch class="ref-pill__icon" width={12} height={12} />;
    case "RemoteBranch":
      return <IconCloud class="ref-pill__icon" width={12} height={12} />;
    case "Tag":
      return <IconTag class="ref-pill__icon" width={12} height={12} />;
  }
}

/** Synthesize a minimal RefTag for ghost rendering — no upstream data. */
function ghostTag(name: string, kind: RefTag["kind"]): RefTag {
  return { name, kind, upstream: null, ahead: 0, behind: 0 };
}

/**
 * Build the ghost ref list for a row: refs that pass through this commit
 * but don't tip here. Sourced from `child_refs` (populated bottom-up in
 * graph-core), minus refs that already render as real pills, minus
 * user-hidden refs.
 */
function ghostRefsFor(
  childRefs: ChildRefs,
  liveRefs: RefTag[],
  hidden: Set<string>,
): RefTag[] {
  const liveByBucket = {
    head: new Set<string>(),
    remote: new Set<string>(),
    tag: new Set<string>(),
  };
  for (const r of liveRefs) {
    liveByBucket[hoveredKindFor(r.kind)].add(r.name);
  }
  const out: RefTag[] = [];
  for (const name of childRefs.heads) {
    if (liveByBucket.head.has(name)) continue;
    const tag = ghostTag(name, "Branch");
    if (hidden.has(refKey(tag))) continue;
    out.push(tag);
  }
  for (const name of childRefs.remotes) {
    if (liveByBucket.remote.has(name)) continue;
    const tag = ghostTag(name, "RemoteBranch");
    if (hidden.has(refKey(tag))) continue;
    out.push(tag);
  }
  for (const name of childRefs.tags) {
    if (liveByBucket.tag.has(name)) continue;
    const tag = ghostTag(name, "Tag");
    if (hidden.has(refKey(tag))) continue;
    out.push(tag);
  }
  return out;
}

interface RefPillProps {
  tag: RefTag;
  sha: string;
  active?: boolean;
  pinned?: boolean;
  ghost?: boolean;
  /** When true, suppress the hide-btn slot (matches GK's `!hasActive` gate). */
  suppressHide?: boolean;
}

function RefPill(props: RefPillProps) {
  const ops = useBranchOps();
  const enter = () => {
    if (props.ghost) return;
    setHoveredRef({
      kind: hoveredKindFor(props.tag.kind),
      name: props.tag.name,
    });
  };
  const leave = () => {
    if (props.ghost) return;
    clearHoveredRef();
  };
  const hide = (e: MouseEvent) => {
    e.stopPropagation();
    setHiddenRef(refKey(props.tag), true);
  };
  // Compact mode does NOT change pill anatomy — verified against GK's
  // bundle (`mode: Compact` is telemetry metadata, not a rendering
  // switch). Pills always render full text + icons; the only effect
  // of compact mode is column widths + reorder + dateTime hidden.
  const showMonitor = () => props.active === true;
  const showCloud = () =>
    props.tag.kind === "Branch" && props.tag.upstream !== null;
  return (
    <span
      class="ref-pill"
      classList={{
        [pillKindClass(props.tag.kind)]: true,
        "is-active": props.active,
        "is-pinned": props.pinned && !props.active,
        "is-ghost": props.ghost,
      }}
      title={props.tag.name}
      tabIndex={props.ghost ? -1 : 0}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
      onContextMenu={(e) => {
        if (props.ghost) return;
        ops.openRefContextMenu(e, props.tag, props.sha);
      }}
    >
      <Show when={props.active}>
        <IconCheck class="ref-pill__annotation" width={12} height={12} />
      </Show>
      <Show when={props.pinned && !props.active}>
        <IconPin class="ref-pill__annotation" width={12} height={12} />
      </Show>
      <PillKindIcon kind={props.tag.kind} />
      <span class="ref-pill__name">{props.tag.name}</span>
      <Show when={showMonitor()}>
        <IconMonitor class="ref-pill__icon-r" width={11} height={11} />
      </Show>
      <Show when={showCloud()}>
        <IconCloud class="ref-pill__icon-r" width={11} height={11} />
      </Show>
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
      <Show when={!props.ghost && !props.suppressHide && props.tag.kind !== "Head"}>
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
 * behind a `+N` chip that opens a hover-delayed popover. Ghost pills for
 * refs that pass through this commit (sourced from `childRefs`) appear
 * only while the row is hovered.
 */
export function RefPillGroup(props: {
  refs: RefTag[];
  sha: string;
  childRefs: ChildRefs;
  isRowHovered: boolean;
}) {
  const isPinnedRow = () => pinnedSha() === props.sha;
  const visibleRefs = () =>
    props.refs.filter((r) => {
      const key = refKey(r);
      if (hiddenRefs().has(key)) return false;
      // Smart Branch Visibility: hide stale (tip > N days old) when the
      // toggle is enabled. The set is empty when the toggle is off.
      if (staleRefs().has(key)) return false;
      return true;
    });
  const ordered = () => orderRefs(visibleRefs(), isPinnedRow());
  const hasActive = () => ordered().some((r) => r.kind === "Head");
  const isPinnedPill = (tag: RefTag, idx: number) => {
    if (!isPinnedRow()) return false;
    if (tag.kind !== "Branch") return false;
    return ordered().findIndex((r) => r.kind === "Branch") === idx;
  };
  const ghostRefs = () =>
    props.isRowHovered
      ? ghostRefsFor(props.childRefs, props.refs, hiddenRefs())
      : [];
  const orderedGhosts = () =>
    [...ghostRefs()].sort((a, b) => {
      const p = typePriority(b.kind) - typePriority(a.kind);
      if (p !== 0) return p;
      return a.name.localeCompare(b.name);
    });

  // Hover-delayed popover (GK uses 250 ms via OverlayTrigger). Open on
  // pointer-enter of the +N chip after the delay; cancel if the pointer
  // leaves before it elapses; keep open as long as the pointer stays in
  // the chip OR the popover (uses a small grace timer on leave so the
  // user can move diagonally between the two).
  const HOVER_OPEN_DELAY = 250;
  const HOVER_CLOSE_DELAY = 120;
  const [popoverOpen, setPopoverOpen] = createSignal(false);
  // Popover renders in a Portal so it can escape the BRANCH/TAG zone's
  // `overflow: hidden`. Position is captured from the trigger's
  // `getBoundingClientRect()` at open time (fixed coords).
  const [popoverPos, setPopoverPos] = createSignal<{ top: number; left: number } | null>(null);
  let triggerEl: HTMLButtonElement | undefined;
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;

  const openPopover = () => {
    if (triggerEl) {
      const rect = triggerEl.getBoundingClientRect();
      setPopoverPos({ top: rect.bottom + 4, left: rect.left });
    }
    setPopoverOpen(true);
  };

  const cancelTimers = () => {
    if (openTimer) {
      clearTimeout(openTimer);
      openTimer = undefined;
    }
    if (closeTimer) {
      clearTimeout(closeTimer);
      closeTimer = undefined;
    }
  };
  const scheduleOpen = () => {
    cancelTimers();
    openTimer = setTimeout(() => openPopover(), HOVER_OPEN_DELAY);
  };
  const scheduleClose = () => {
    cancelTimers();
    closeTimer = setTimeout(() => setPopoverOpen(false), HOVER_CLOSE_DELAY);
  };
  const keepOpen = () => cancelTimers();
  onCleanup(cancelTimers);

  // Close on Escape — preserves keyboard escape hatch for hover popovers.
  createEffect(() => {
    if (!popoverOpen()) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPopoverOpen(false);
    };
    document.addEventListener("keydown", onKey);
    onCleanup(() => document.removeEventListener("keydown", onKey));
  });

  return (
    <Show when={ordered().length > 0 || orderedGhosts().length > 0}>
      <span
        class="ref-node"
        classList={{
          "has-active": hasActive(),
          "row-hovered": props.isRowHovered,
        }}
      >
        <Show when={ordered().length > 0}>
          <RefPill
            tag={ordered()[0]}
            sha={props.sha}
            active={ordered()[0].kind === "Head"}
            pinned={isPinnedPill(ordered()[0], 0)}
            suppressHide={hasActive()}
          />
        </Show>
        <Show when={ordered().length > 1}>
          <button
            type="button"
            class="ref-node__overflow"
            classList={{ "is-active": hasActive() }}
            ref={(el) => (triggerEl = el)}
            onMouseEnter={scheduleOpen}
            onMouseLeave={scheduleClose}
            onFocus={scheduleOpen}
            onBlur={scheduleClose}
            // Click toggles too — accessibility for keyboard users + a
            // fallback when hover misfires (touchscreens, slow trackpads).
            onClick={(e) => {
              e.stopPropagation();
              cancelTimers();
              if (popoverOpen()) {
                setPopoverOpen(false);
              } else {
                openPopover();
              }
            }}
            aria-label={`${ordered().length - 1} more ref${ordered().length - 1 === 1 ? "" : "s"}`}
            aria-expanded={popoverOpen()}
          >
            +{ordered().length - 1}
          </button>
        </Show>
        <Show when={popoverOpen() && popoverPos() !== null}>
          <Portal>
            <div
              class="ref-node__popover"
              style={{
                top: `${popoverPos()!.top}px`,
                left: `${popoverPos()!.left}px`,
              }}
              onMouseEnter={keepOpen}
              onMouseLeave={scheduleClose}
              onClick={(e) => e.stopPropagation()}
            >
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
          </Portal>
        </Show>
        <Show when={orderedGhosts().length > 0}>
          <span class="ref-node__ghosts">
            <For each={orderedGhosts()}>
              {(r) => <RefPill tag={r} sha={props.sha} ghost />}
            </For>
          </span>
        </Show>
      </span>
    </Show>
  );
}
