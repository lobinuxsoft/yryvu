// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, onCleanup, onMount, Show } from "solid-js";

import { Tooltip } from "../Tooltip";

export type CommitAction = "commit" | "commit-and-push";

export interface CommitButtonProps {
  /// Primary button label ("Commit Changes to N Files" / "Amend HEAD …").
  label: string;
  /// Button disabled when no staged changes or empty summary.
  disabled: boolean;
  /// Title / hover tooltip — explains why the button is disabled when it is.
  title: string;
  /// "commit" vs "amend" colour theme.
  mode: "commit" | "amend";
  onCommit: () => void;
  onCommitAndPush: () => void;
}

/// Split button: primary action `Commit` on the left, caret on the right
/// that opens a menu with `Commit and Push`. Matches GitKraken's commit
/// zone bottom-button shape.
export function CommitButton(props: CommitButtonProps) {
  const [menuOpen, setMenuOpen] = createSignal(false);
  let rootEl: HTMLDivElement | undefined;

  // Click-outside dismiss: cheap global listener, skipped when menu closed.
  onMount(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!menuOpen()) return;
      if (rootEl && !rootEl.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    onCleanup(() => document.removeEventListener("click", onDocClick));
  });

  return (
    <div
      class="commit-panel__submit-split"
      ref={(el) => (rootEl = el)}
      data-mode={props.mode}
    >
      <Tooltip text={props.title}>
        <button
          class="commit-panel__submit"
          type="button"
          disabled={props.disabled}
          onClick={() => props.onCommit()}
        >
          {props.label}
        </button>
      </Tooltip>
      <Tooltip text="More commit actions">
        <button
          class="commit-panel__submit-caret"
          type="button"
          disabled={props.disabled}
          aria-haspopup="menu"
          aria-expanded={menuOpen() ? "true" : "false"}
          onClick={() => setMenuOpen((v) => !v)}
        >
          ▾
        </button>
      </Tooltip>
      <Show when={menuOpen()}>
        <ul class="commit-panel__submit-menu" role="menu">
          <li>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                props.onCommitAndPush();
              }}
            >
              Commit and Push
            </button>
          </li>
        </ul>
      </Show>
    </div>
  );
}
