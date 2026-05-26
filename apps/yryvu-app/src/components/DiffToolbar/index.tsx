// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Diff view-mode toolbar (issue #59 — GitKraken `data-testid="diff-options"`
 * parity).
 *
 * Two-layer toggle:
 *   1. Outer: File View / Diff View.
 *   2. Inner (only when Diff): Hunk / Inline / Split.
 *
 * Action buttons:
 *   - Previous change / Next change — wired through the
 *     `diffNavigator` signal channel set up by the diff body. No-wrap at
 *     list ends (matches GK exactly).
 *
 * Icons mirror the Font Awesome references from `docs/research/gitkraken-diff/02-view-modes.md`.
 */

import { For, type JSX, Show } from "solid-js";

import {
  diffNavigator,
  fileViewMode,
  isDiffMode,
  outerView,
  setDiffViewMode,
  setOuterView,
  type DiffViewMode,
  type OuterView,
} from "../../state";
import {
  IconArrowDown,
  IconArrowUp,
  IconBlame,
  IconColumns,
  IconDiff,
  IconFile,
  IconList,
  IconListAlt,
} from "../Icons";
import { Tooltip } from "../Tooltip";

interface DiffModeButton {
  id: DiffViewMode;
  label: string;
  testId: string;
  icon: () => JSX.Element;
}

const DIFF_MODE_BUTTONS: DiffModeButton[] = [
  {
    id: "hunk",
    label: "Hunk View",
    testId: "toggleHunkViewButton",
    icon: () => <IconListAlt />,
  },
  {
    id: "inline",
    label: "Inline View",
    testId: "toggleInlineViewButton",
    icon: () => <IconList />,
  },
  {
    id: "split",
    label: "Split View",
    testId: "toggleSplitViewButton",
    icon: () => <IconColumns />,
  },
];

interface OuterButtonProps {
  view: OuterView;
  label: string;
  icon: () => JSX.Element;
}

function OuterButton(props: OuterButtonProps): JSX.Element {
  const active = () => outerView() === props.view;
  return (
    <button
      class="diff-toolbar__btn diff-toolbar__btn--toggle"
      type="button"
      role="radio"
      aria-checked={active()}
      data-active={active()}
      onClick={() => setOuterView(props.view)}
    >
      {props.icon()}
      <span class="diff-toolbar__label">{props.label}</span>
    </button>
  );
}

export function DiffToolbar(): JSX.Element {
  return (
    <div class="diff-toolbar" data-testid="diff-options">
      <div class="diff-toolbar__group diff-toolbar__group--nav">
        <Tooltip text="Previous change">
          <button
            class="diff-toolbar__btn"
            type="button"
            data-testid="previousDiffButton"
            aria-label="Previous change"
            disabled={!diffNavigator()}
            onClick={() => diffNavigator()?.prev()}
          >
            <IconArrowUp />
          </button>
        </Tooltip>
        <Tooltip text="Next change">
          <button
            class="diff-toolbar__btn"
            type="button"
            data-testid="nextDiffButton"
            aria-label="Next change"
            disabled={!diffNavigator()}
            onClick={() => diffNavigator()?.next()}
          >
            <IconArrowDown />
          </button>
        </Tooltip>
      </div>

      <div
        class="diff-toolbar__group diff-toolbar__group--outer"
        role="radiogroup"
        aria-label="View mode"
      >
        <OuterButton view="file" label="File View" icon={() => <IconFile />} />
        <OuterButton view="diff" label="Diff View" icon={() => <IconDiff />} />
        <OuterButton view="blame" label="Blame" icon={() => <IconBlame />} />
      </div>

      <Show when={isDiffMode()}>
        <div
          class="diff-toolbar__group diff-toolbar__group--inner"
          role="radiogroup"
          aria-label="Diff mode"
        >
          <For each={DIFF_MODE_BUTTONS}>
            {(btn) => {
              const active = () => fileViewMode() === btn.id;
              return (
                <Tooltip text={btn.label}>
                  <button
                    class="diff-toolbar__btn"
                    type="button"
                    role="radio"
                    aria-checked={active()}
                    aria-label={btn.label}
                    data-testid={btn.testId}
                    data-active={active()}
                    onClick={() => setDiffViewMode(btn.id)}
                  >
                    {btn.icon()}
                  </button>
                </Tooltip>
              );
            }}
          </For>
        </div>
      </Show>
    </div>
  );
}
