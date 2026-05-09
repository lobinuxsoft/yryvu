// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show, type JSX } from "solid-js";

interface Props {
  icon: JSX.Element;
  label: string;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
  /// Optional numeric overlay shown at the top-right of the icon.
  /// `> 0` renders the badge; falsy / 0 / undefined hides it. Used by
  /// Undo / Redo to surface how many ops are reachable from the cursor.
  badge?: number;
}

export function ToolbarBtn(props: Props) {
  return (
    <button
      class="toolbar__btn"
      type="button"
      disabled={props.disabled}
      title={props.title}
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
  );
}
