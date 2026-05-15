// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show, type JSX } from "solid-js";

import { Tooltip } from "../Tooltip";

interface Props {
  icon: JSX.Element;
  label: string;
  disabled?: boolean;
  /// Optional hover hint. Wrapped in `<Tooltip>` so it honours the
  /// global `tooltipsEnabled` + `tooltipDelayMs` preferences (#316);
  /// `aria-label` survives even when tooltips are visually disabled.
  title?: string;
  onClick?: () => void;
  /// Optional numeric overlay shown at the top-right of the icon.
  /// `> 0` renders the badge; falsy / 0 / undefined hides it. Used by
  /// Undo / Redo to surface how many ops are reachable from the cursor.
  badge?: number;
}

export function ToolbarBtn(props: Props) {
  return (
    <Tooltip text={props.title}>
      <button
        class="toolbar__btn"
        type="button"
        disabled={props.disabled}
        onClick={props.onClick}
      >
        <span class="toolbar__btn-icon">
          {props.icon}
          <Show when={props.badge && props.badge > 0}>
            <span class="toolbar__btn-badge">{props.badge}</span>
          </Show>
        </span>
        <span class="toolbar__btn-label">{props.label}</span>
      </button>
    </Tooltip>
  );
}
