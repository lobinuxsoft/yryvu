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

import { For, Show } from "solid-js";
import { Portal } from "solid-js/web";

import type { ChildRefs, RefTag } from "../../../ipc/commits";
import {
  hiddenBySmartFilter,
  hiddenRefs,
  pinnedSha,
} from "../../../state";
import { refKey } from "../../../branchOps";
import { ghostRefsFor, orderRefs, typePriority } from "./ordering";
import { RefPill } from "./RefPill";
import { usePopover } from "./usePopover";

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
      // Smart Branch Visibility: hide refs not in the backend-computed
      // allowlist (empty set when the toggle is off).
      if (hiddenBySmartFilter().has(key)) return false;
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

  const popover = usePopover();

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
            ref={(el) => popover.setTrigger(el)}
            onMouseEnter={popover.scheduleOpen}
            onMouseLeave={popover.scheduleClose}
            onFocus={popover.scheduleOpen}
            onBlur={popover.scheduleClose}
            // Click toggles too — accessibility for keyboard users + a
            // fallback when hover misfires (touchscreens, slow trackpads).
            onClick={(e) => {
              e.stopPropagation();
              popover.toggle();
            }}
            aria-label={`${ordered().length - 1} more ref${ordered().length - 1 === 1 ? "" : "s"}`}
            aria-expanded={popover.open()}
          >
            +{ordered().length - 1}
          </button>
        </Show>
        <Show when={popover.open() && popover.pos() !== null}>
          <Portal>
            <div
              class="ref-node__popover"
              style={{
                top: `${popover.pos()!.top}px`,
                left: `${popover.pos()!.left}px`,
              }}
              onMouseEnter={popover.keepOpen}
              onMouseLeave={popover.scheduleClose}
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
