// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Column-settings ⚙ button on the right edge of the graph column
 * header. Opens a popover with:
 *
 *   - Visibility toggles (one per `GraphZoneId`).
 *   - Compact Graph Column toggle — flips `graphColumnMode`.
 *   - Smart Branch Visibility toggle (auto-hide stale branches).
 *   - Reset columns to default layout.
 *   - Reset columns to compact layout.
 *
 * 1:1 with the GitKraken popover from the user's eggscape screenshot
 * (2026-04-25). Order + grouping match the bundle's menu structure
 * (`compactGraph` + `smartBranches` toggles, then the two layout
 * resets at the bottom).
 *
 * Persistence is handled in `state.ts` — every toggle writes to
 * localStorage immediately so settings survive reloads.
 */

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";

import { IconCheck, IconGear } from "../Icons";
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

export function ColumnSettingsButton() {
  const [open, setOpen] = createSignal(false);
  const [pos, setPos] = createSignal<{ top: number; right: number } | null>(null);
  let triggerEl: HTMLButtonElement | undefined;

  const openMenu = () => {
    if (triggerEl) {
      const rect = triggerEl.getBoundingClientRect();
      setPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    }
    setOpen(true);
  };

  createEffect(() => {
    if (!open()) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        triggerEl?.contains(t) ||
        document
          .querySelector(".graph-col-settings__menu")
          ?.contains(t)
      )
        return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
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
  // visible columns. Every zone is otherwise toggleable — including
  // ref / graph / commitMessage. The previous chajá-specific gate that
  // pinned ref + graph was a chajá invention; removing it fixes #157
  // follow-up where toggling Commit Message off left the body
  // rendering through.
  const visibleCount = () =>
    ALL_ZONES.reduce((n, id) => n + (activeColumnSettings(id).visible ? 1 : 0), 0);
  const isToggleable = (id: GraphZoneId) => !(isVisible(id) && visibleCount() === 1);

  return (
    <>
      <button
        type="button"
        class="graph-col-settings__btn"
        ref={(el) => (triggerEl = el)}
        title="Column settings"
        aria-label="Column settings"
        onClick={(e) => {
          e.stopPropagation();
          if (open()) setOpen(false);
          else openMenu();
        }}
      >
        <IconGear width={14} height={14} />
      </button>
      <Show when={open() && pos() !== null}>
        <Portal>
          <div
            class="graph-col-settings__menu"
            style={{
              top: `${pos()!.top}px`,
              right: `${pos()!.right}px`,
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
                  setOpen(false);
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
                  setOpen(false);
                }}
              >
                <span class="graph-col-settings__check" />
                <span>Reset columns to compact layout</span>
              </button>
            </div>
          </div>
        </Portal>
      </Show>
    </>
  );
}
