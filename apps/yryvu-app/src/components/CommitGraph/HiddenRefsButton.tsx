// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Header-mounted button that lists user-hidden refs and lets them restore
 * any single ref back to the graph. 1:1 port of GitKraken's
 * `header-ref-node-hidden-refs-btn` component (bundle confirms tooltip id
 * + popover-on-click + disabled-when-empty + alpha sort with REMOTE
 * tiebreak via `compareGraphRefOpts`).
 *
 * Lives in the BRANCH/TAG column header so the user always sees the count
 * of hidden refs and has one click to bring them back. No bulk-restore
 * action — matches GK behaviour and avoids accidental un-hide of a
 * carefully curated list.
 */

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import { Portal } from "solid-js/web";

import { IconBranch, IconCloud, IconEye, IconTag } from "../Icons";
import { Tooltip } from "../Tooltip";
import type { RefTag } from "../../ipc/commits";
import { hiddenRefs, setHiddenRef } from "../../state";

interface ParsedKey {
  key: string;
  kind: RefTag["kind"];
  name: string;
}

/** Parse a `<kind>/<name>` storage key back into its parts. */
function parseKey(key: string): ParsedKey | null {
  const idx = key.indexOf("/");
  if (idx < 0) return null;
  const kindStr = key.slice(0, idx);
  const name = key.slice(idx + 1);
  if (
    kindStr !== "Head" &&
    kindStr !== "Branch" &&
    kindStr !== "RemoteBranch" &&
    kindStr !== "Tag"
  ) {
    return null;
  }
  return { key, kind: kindStr, name };
}

function kindRank(kind: RefTag["kind"]): number {
  // GK's compareGraphRefOpts: alpha primary, REMOTE wins ties.
  return kind === "RemoteBranch" ? 0 : 1;
}

function compareEntries(a: ParsedKey, b: ParsedKey): number {
  const cmp = a.name.localeCompare(b.name);
  if (cmp !== 0) return cmp;
  return kindRank(a.kind) - kindRank(b.kind);
}

function HiddenRefIcon(props: { kind: RefTag["kind"] }) {
  switch (props.kind) {
    case "Head":
    case "Branch":
      return <IconBranch width={12} height={12} />;
    case "RemoteBranch":
      return <IconCloud width={12} height={12} />;
    case "Tag":
      return <IconTag width={12} height={12} />;
  }
}

export function HiddenRefsButton() {
  const entries = () => {
    const out: ParsedKey[] = [];
    for (const key of hiddenRefs()) {
      const parsed = parseKey(key);
      if (parsed) out.push(parsed);
    }
    return out.sort(compareEntries);
  };
  const count = () => entries().length;
  const disabled = () => count() === 0;

  const [open, setOpen] = createSignal(false);
  const [pos, setPos] = createSignal<{ top: number; left: number } | null>(null);
  let rootEl: HTMLSpanElement | undefined;
  let triggerEl: HTMLButtonElement | undefined;

  // Auto-close when the last hidden ref is restored — popover with empty
  // list looks broken otherwise.
  createEffect(() => {
    if (open() && count() === 0) setOpen(false);
  });

  const openPopover = () => {
    if (triggerEl) {
      const rect = triggerEl.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen(true);
  };

  createEffect(() => {
    if (!open()) return;
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootEl?.contains(t)) return;
      if (
        document.querySelector(".hidden-refs__popover")?.contains(t)
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

  return (
    <span class="hidden-refs" ref={(el) => (rootEl = el)}>
      <Tooltip
        text={
          disabled()
            ? "No hidden refs"
            : `${count()} hidden ref${count() === 1 ? "" : "s"}`
        }
      >
      <button
        type="button"
        class="hidden-refs__btn"
        ref={(el) => (triggerEl = el)}
        disabled={disabled()}
        aria-label="Hidden refs"
        onClick={(e) => {
          e.stopPropagation();
          if (disabled()) return;
          if (open()) setOpen(false);
          else openPopover();
        }}
      >
        <IconEye width={14} height={14} />
        <Show when={count() > 0}>
          <span class="hidden-refs__count">{count()}</span>
        </Show>
      </button>
      </Tooltip>
      <Show when={open() && pos() !== null}>
        <Portal>
          <div
            class="hidden-refs__popover"
            style={{
              top: `${pos()!.top}px`,
              left: `${pos()!.left}px`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div class="hidden-refs__popover-title">Hidden refs</div>
            <ul class="hidden-refs__list">
              <For each={entries()}>
                {(entry) => (
                  <li class="hidden-refs__list-item">
                    <span class="hidden-refs__icon">
                      <HiddenRefIcon kind={entry.kind} />
                    </span>
                    <Tooltip text={entry.name}>
                      <span class="hidden-refs__name">{entry.name}</span>
                    </Tooltip>
                    <Tooltip text={`Show '${entry.name}'`}>
                      <button
                        type="button"
                        class="hidden-refs__restore"
                        onClick={() => setHiddenRef(entry.key, false)}
                      >
                        Show
                      </button>
                    </Tooltip>
                  </li>
                )}
              </For>
            </ul>
          </div>
        </Portal>
      </Show>
    </span>
  );
}
