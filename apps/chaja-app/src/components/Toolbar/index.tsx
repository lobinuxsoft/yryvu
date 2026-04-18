// SPDX-License-Identifier: AGPL-3.0-or-later

import { type JSX, Show } from "solid-js";

import { repoPath } from "../../state";
import {
  IconArrowDown,
  IconArrowUp,
  IconBranch,
  IconChevronDown,
  IconGear,
  IconRedo,
  IconSearch,
  IconStashIn,
  IconStashOut,
  IconTerminal,
  IconUndo,
} from "../Icons";

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
        <ToolbarBtn icon={<IconUndo />} label="Undo" disabled />
        <ToolbarBtn icon={<IconRedo />} label="Redo" disabled />
        <ToolbarBtn icon={<IconArrowDown />} label="Pull" disabled split />
        <ToolbarBtn icon={<IconArrowUp />} label="Push" disabled />
        <ToolbarBtn icon={<IconBranch />} label="Branch" disabled />
        <ToolbarBtn icon={<IconStashIn />} label="Stash" disabled />
        <ToolbarBtn icon={<IconStashOut />} label="Pop" disabled />
        <ToolbarBtn icon={<IconTerminal />} label="Terminal" disabled />
      </div>

      <div class="toolbar__actions">
        <ToolbarBtn icon={<IconGear />} label="Actions" disabled />
        <ToolbarBtn icon={<IconSearch />} label="Search" disabled />
      </div>
    </div>
  );
}

function ToolbarBtn(props: {
  icon: JSX.Element;
  label: string;
  disabled?: boolean;
  split?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      class="toolbar__btn"
      classList={{ "toolbar__btn-split": props.split }}
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <span class="toolbar__btn-icon">{props.icon}</span>
      <span class="toolbar__btn-label">
        {props.label}
        <Show when={props.split}>
          <span class="toolbar__btn-split-caret">
            <IconChevronDown width="10" height="10" />
          </span>
        </Show>
      </span>
    </button>
  );
}
