// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Column-settings ⚙ button + popover menu (1:1 with GitKraken's column
 * header chrome). The menu is also exposed as a standalone component
 * (`ColumnSettingsMenu`) so the same popover can be opened from a
 * right-click context menu on any column header — matching GK where
 * right-clicking a column header surfaces the same options as the gear.
 *
 * The menu offers:
 *   - Visibility toggles (one per `GraphZoneId`).
 *   - Compact Graph Column toggle — flips `graphColumnMode`.
 *   - Smart Branch Visibility toggle (auto-hide stale branches).
 *   - Reset columns to default layout / compact layout.
 *
 * Persistence is handled in `state.ts` — every toggle writes to
 * localStorage immediately so settings survive reloads.
 */

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";

import { IconCheck, IconGear } from "../Icons";
import { Tooltip } from "../Tooltip";
import {
  activeColumnSettings,
  commitZoneMode,
  resetColumnsToCompactLayout,
  resetColumnsToDefaultLayout,
  setGraphZoneVisible,
  setSmartBranchesEnabled,
  smartBranchesEnabled,
  toggleCommitZoneMode,
} from "../../state";
import { ALL_ZONES, ZONE_SPECS, type GraphZoneId } from "./columns";

export interface MenuPos {
  top: number;
  right: number;
}

export function ColumnSettingsMenu(props: {
  pos: MenuPos;
  onClose: () => void;
}) {
  createEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        document.querySelector(".graph-col-settings__menu")?.contains(t) ||
        (t as Element)?.closest?.(".graph-col-settings__btn")
      ) {
        return;
      }
      props.onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    });
  });

  const isVisible = (id: GraphZoneId) => activeColumnSettings(id).visible;
  // 1:1 with GK's `enabled: !(gn && 1 === Ve.length)` (bundle ~342409):
  // a checkbox is disabled only when it would leave the user with zero
  // visible columns.
  const visibleCount = () =>
    ALL_ZONES.reduce((n, id) => n + (activeColumnSettings(id).visible ? 1 : 0), 0);
  const isToggleable = (id: GraphZoneId) =>
    !(isVisible(id) && visibleCount() === 1);

  return (
    <Portal>
      <div
        class="graph-col-settings__menu"
        style={{
          top: `${props.pos.top}px`,
          right: `${props.pos.right}px`,
        }}
      >
        <div class="graph-col-settings__group">
          <For each={ALL_ZONES}>
            {(id) => (
              <button
                type="button"
                class="graph-col-settings__item"
                classList={{ "is-disabled": !isToggleable(id) }}
                disabled={!isToggleable(id)}
                onClick={() => setGraphZoneVisible(id, !isVisible(id))}
              >
                <span class="graph-col-settings__check">
                  <Show when={isVisible(id)}>
                    <IconCheck width={12} height={12} />
                  </Show>
                </span>
                <span>{ZONE_SPECS[id].label}</span>
              </button>
            )}
          </For>
        </div>
        <div class="graph-col-settings__separator" />
        <div class="graph-col-settings__group">
          <button
            type="button"
            class="graph-col-settings__item"
            onClick={() => toggleCommitZoneMode()}
          >
            <span class="graph-col-settings__check">
              <Show when={commitZoneMode() === "compact"}>
                <IconCheck width={12} height={12} />
              </Show>
            </span>
            <span>Compact Graph Column</span>
          </button>
          <button
            type="button"
            class="graph-col-settings__item"
            onClick={() => setSmartBranchesEnabled(!smartBranchesEnabled())}
          >
            <span class="graph-col-settings__check">
              <Show when={smartBranchesEnabled()}>
                <IconCheck width={12} height={12} />
              </Show>
            </span>
            <span>Smart Branch Visibility</span>
          </button>
        </div>
        <div class="graph-col-settings__separator" />
        <div class="graph-col-settings__group">
          <button
            type="button"
            class="graph-col-settings__item"
            onClick={() => {
              resetColumnsToDefaultLayout();
              props.onClose();
            }}
          >
            <span class="graph-col-settings__check" />
            <span>Reset columns to default layout</span>
          </button>
          <button
            type="button"
            class="graph-col-settings__item"
            onClick={() => {
              resetColumnsToCompactLayout();
              props.onClose();
            }}
          >
            <span class="graph-col-settings__check" />
            <span>Reset columns to compact layout</span>
          </button>
        </div>
      </div>
    </Portal>
  );
}

export function ColumnSettingsButton(props: {
  onOpen: (pos: MenuPos) => void;
  isOpen: () => boolean;
  onClose: () => void;
}) {
  let triggerEl: HTMLButtonElement | undefined;

  const handleClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (props.isOpen()) {
      props.onClose();
      return;
    }
    if (triggerEl) {
      const rect = triggerEl.getBoundingClientRect();
      props.onOpen({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
  };

  return (
    <Tooltip text="Column settings">
      <button
        type="button"
        class="graph-col-settings__btn"
        ref={(el) => (triggerEl = el)}
        aria-label="Column settings"
        onClick={handleClick}
      >
        <IconGear width={14} height={14} />
      </button>
    </Tooltip>
  );
}

// Keep the createSignal helper colocated for callers that need module-local
// state (currently only `GraphColumnHeaders`).
export function createMenuState() {
  const [pos, setPos] = createSignal<MenuPos | null>(null);
  return {
    pos,
    isOpen: () => pos() !== null,
    open: (p: MenuPos) => setPos(p),
    close: () => setPos(null),
  };
}
