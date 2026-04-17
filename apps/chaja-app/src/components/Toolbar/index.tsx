// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import { repoPath } from "../../state";

export interface ToolbarProps {
  onOpenRepo: () => void;
}

export function Toolbar(props: ToolbarProps) {
  const currentRepoName = () => {
    const p = repoPath();
    if (!p) return undefined;
    return p.split("/").filter(Boolean).pop() ?? p;
  };

  return (
    <div class="toolbar">
      <div class="toolbar__selector">
        <span>repository</span>
        <button class="toolbar__selector-value" type="button" onClick={props.onOpenRepo}>
          <Show when={currentRepoName()} fallback={<em>No repo</em>}>
            {(name) => <>{name()} <span class="toolbar__arrow">▾</span></>}
          </Show>
        </button>
      </div>

      <span class="toolbar__arrow">→</span>

      <div class="toolbar__selector">
        <span>branch</span>
        <button class="toolbar__selector-value" type="button" disabled>
          <em>— </em>
        </button>
      </div>

      <div class="toolbar__spacer" />

      <div class="toolbar__actions">
        <ToolbarBtn icon="↶" label="Undo" disabled />
        <ToolbarBtn icon="↷" label="Redo" disabled />
        <ToolbarBtn icon="↓" label="Pull" disabled split />
        <ToolbarBtn icon="↑" label="Push" disabled />
        <ToolbarBtn icon="⎇" label="Branch" disabled />
        <ToolbarBtn icon="⊞" label="Stash" disabled />
        <ToolbarBtn icon="⊟" label="Pop" disabled />
        <ToolbarBtn icon="›_" label="Terminal" disabled />
      </div>

      <div class="toolbar__actions">
        <ToolbarBtn icon="⚙" label="Actions" disabled />
        <ToolbarBtn icon="🔍" label="Search" disabled />
      </div>
    </div>
  );
}

function ToolbarBtn(props: {
  icon: string;
  label: string;
  disabled?: boolean;
  split?: boolean;
  onClick?: () => void;
}) {
  const classes = () => {
    const base = "toolbar__btn";
    return props.split ? `${base} toolbar__btn-split` : base;
  };
  return (
    <button class={classes()} type="button" disabled={props.disabled} onClick={props.onClick}>
      <span class="toolbar__btn-icon">{props.icon}</span>
      <span class="toolbar__btn-label">{props.label}</span>
      <Show when={props.split}>
        <span class="toolbar__btn-split-caret">▾</span>
      </Show>
    </button>
  );
}
