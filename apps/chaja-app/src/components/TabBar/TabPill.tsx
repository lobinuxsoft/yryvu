// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Single tab pill — renders a transient tab from the store. Click body
 * switches, hover surfaces the × close button, click × closes (audit
 * doc 03).
 *
 * Title source per type:
 *   REPO          → last path segment of repoPath (or "Repo" fallback)
 *   NEW           → "New Tab"
 *   RELEASE_NOTES → "Release Notes"
 *
 * The native `title` attr supplies the tooltip on truncated labels.
 * Audit doc 03 specifies a 600ms hover delay + 250px max width — that's
 * a custom tooltip surface we'll port when a future cluster needs it
 * (skeleton already in tabs.css). For v1 the OS-native tooltip suffices.
 */

import { Show } from "solid-js";

import { IconClose } from "../Icons";
import { type Tab } from "../../tabs/types";

interface Props {
  tab: Tab;
  isActive: boolean;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
}

function titleOf(tab: Tab): string {
  switch (tab.type) {
    case "REPO": {
      const seg = tab.repoPath.split("/").filter(Boolean).pop();
      return seg ?? "Repo";
    }
    case "NEW":
      return "New Tab";
    case "RELEASE_NOTES":
      return "Release Notes";
  }
}

export function TabPill(props: Props) {
  const title = () => titleOf(props.tab);

  const onClickPill = (e: MouseEvent) => {
    // Middle-click closes the tab — matches the convention in browsers
    // and editors. No CLI / context menu wiring in this PR.
    if (e.button === 1) {
      e.preventDefault();
      props.onClose(props.tab.id);
      return;
    }
    if (e.button !== 0) return;
    props.onSelect(props.tab.id);
  };

  const onClickClose = (e: MouseEvent) => {
    e.stopPropagation();
    props.onClose(props.tab.id);
  };

  return (
    <div
      class="tab"
      classList={{ "is-active": props.isActive }}
      role="tab"
      aria-selected={props.isActive}
      title={title()}
      onMouseDown={onClickPill}
    >
      <span class="tab__title">{title()}</span>
      <Show when={props.tab.type !== "NEW" || props.isActive}>
        <button
          class="tab__close"
          type="button"
          aria-label={`Close ${title()}`}
          title="Close tab"
          onClick={onClickClose}
        >
          <IconClose width={10} height={10} />
        </button>
      </Show>
    </div>
  );
}
