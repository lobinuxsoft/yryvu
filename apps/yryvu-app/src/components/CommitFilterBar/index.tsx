// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Commit filter bar (issue #111).
 *
 * Renders above the commit graph. Five chip types (author / message /
 * dateFrom / dateTo / shaPrefix / path) composable with AND
 * semantics. Each chip carries an inline input and a remove (×)
 * button. A trailing "Clear all" button appears whenever any chip is
 * active.
 *
 * Inactive surface = single "+ Add filter" trigger that pops a chip-
 * type menu — keeps the bar tiny when nothing's active.
 */

import { createSignal, For, type JSX, Show } from "solid-js";

import {
  clearCommitFilter,
  commitFilter,
  isCommitFilterActive,
  setCommitFilter,
  type CommitFilter,
} from "../../state";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { IconClose, IconFilter, IconPlus } from "../Icons";
import { Tooltip } from "../Tooltip";

type ChipKey =
  | "author"
  | "message"
  | "shaPrefix"
  | "path"
  | "dateFrom"
  | "dateTo";

interface ChipDef {
  key: ChipKey;
  label: string;
  placeholder: string;
  type: "text" | "date";
}

const CHIP_DEFS: ChipDef[] = [
  { key: "author", label: "Author", placeholder: "name or email", type: "text" },
  { key: "message", label: "Message", placeholder: "substring", type: "text" },
  { key: "shaPrefix", label: "SHA", placeholder: "prefix", type: "text" },
  { key: "path", label: "Path", placeholder: "src/foo.ts", type: "text" },
  { key: "dateFrom", label: "From", placeholder: "yyyy-mm-dd", type: "date" },
  { key: "dateTo", label: "To", placeholder: "yyyy-mm-dd", type: "date" },
];

function chipValue(f: CommitFilter, key: ChipKey): string {
  if (key === "dateFrom" || key === "dateTo") {
    const v = f[key];
    return v === undefined ? "" : new Date(v * 1000).toISOString().slice(0, 10);
  }
  return (f[key] ?? "") as string;
}

function isChipActive(f: CommitFilter, key: ChipKey): boolean {
  if (key === "dateFrom" || key === "dateTo") return f[key] !== undefined;
  return ((f[key] ?? "") as string).length > 0;
}

function patchChip(f: CommitFilter, key: ChipKey, raw: string): CommitFilter {
  if (key === "dateFrom" || key === "dateTo") {
    if (raw === "") return { ...f, [key]: undefined };
    const ts = Date.parse(raw + "T00:00:00Z");
    if (Number.isNaN(ts)) return f;
    return { ...f, [key]: Math.floor(ts / 1000) };
  }
  return { ...f, [key]: raw };
}

function removeChip(f: CommitFilter, key: ChipKey): CommitFilter {
  if (key === "dateFrom" || key === "dateTo") return { ...f, [key]: undefined };
  return { ...f, [key]: "" };
}

export function CommitFilterBar(): JSX.Element {
  const [menu, setMenu] = createSignal<
    { x: number; y: number; items: ContextMenuItem[] } | null
  >(null);

  function openAddMenu(e: MouseEvent) {
    const f = commitFilter();
    const items: ContextMenuItem[] = CHIP_DEFS.filter(
      (c) => !isChipActive(f, c.key),
    ).map((c) => ({
      label: c.label,
      onSelect: () => {
        // Activating a date chip just toggles it on with today's date
        // so the input is anchored; text chips activate empty so the
        // user types into the inline input directly.
        if (c.key === "dateFrom" || c.key === "dateTo") {
          const today = Math.floor(Date.now() / 1000);
          setCommitFilter((prev) => ({ ...prev, [c.key]: today }));
        } else {
          setCommitFilter((prev) => ({ ...prev, [c.key]: " " }));
          // Defer one frame so the input mounts before we focus it.
          requestAnimationFrame(() => {
            const el = document.querySelector<HTMLInputElement>(
              `[data-chip="${c.key}"] input`,
            );
            if (el) {
              el.focus();
              el.select();
            }
          });
        }
      },
    }));
    if (items.length === 0) return;
    setMenu({ x: e.clientX, y: e.clientY, items });
  }

  return (
    <div class="commit-filter-bar" data-testid="commit-filter">
      <span class="commit-filter-bar__icon" aria-hidden="true">
        <IconFilter />
      </span>
      <For each={CHIP_DEFS}>
        {(def) => (
          <Show when={isChipActive(commitFilter(), def.key)}>
            <span class="commit-filter-chip" data-chip={def.key}>
              <span class="commit-filter-chip__label">{def.label}</span>
              <input
                class="commit-filter-chip__input"
                type={def.type}
                placeholder={def.placeholder}
                value={chipValue(commitFilter(), def.key)}
                onInput={(e) =>
                  setCommitFilter((prev) =>
                    patchChip(prev, def.key, e.currentTarget.value),
                  )
                }
              />
              <Tooltip text={`Remove ${def.label.toLowerCase()} filter`}>
                <button
                  class="commit-filter-chip__remove"
                  type="button"
                  aria-label={`Remove ${def.label} filter`}
                  onClick={() =>
                    setCommitFilter((prev) => removeChip(prev, def.key))
                  }
                >
                  <IconClose />
                </button>
              </Tooltip>
            </span>
          </Show>
        )}
      </For>

      <Tooltip text="Add filter">
        <button
          class="commit-filter-bar__add"
          type="button"
          aria-label="Add filter"
          onClick={openAddMenu}
        >
          <IconPlus />
          <Show when={!isCommitFilterActive()}>
            <span class="commit-filter-bar__add-label">Add filter</span>
          </Show>
        </button>
      </Tooltip>

      <Show when={isCommitFilterActive()}>
        <button
          class="commit-filter-bar__clear"
          type="button"
          onClick={() => clearCommitFilter()}
        >
          Clear all
        </button>
      </Show>

      <Show when={menu()}>
        <ContextMenu
          x={menu()!.x}
          y={menu()!.y}
          items={menu()!.items}
          onClose={() => setMenu(null)}
        />
      </Show>
    </div>
  );
}
