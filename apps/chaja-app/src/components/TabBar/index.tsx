// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Tab strip — the right-hand cluster of pills + + + chevron. The leading
 * (open-repo / favorites) cluster is owned by AppShell and stays
 * unchanged; this component is only the strip itself.
 *
 * Layout (cited bundle:330605-330614, audit doc 03):
 *
 *     [REPO_MGMT][tab1][tab2][tab3][ + ][ ⌄ ]
 *     └ permanent┘└ transient strip ┘
 *
 * Permanent pills render LEFT of transient. The dropdown chevron is
 * a stub until #206 wires the menu — visible-but-disabled.
 */

import { For, Show } from "solid-js";

import { IconChevronDown, IconPlus } from "../Icons";
import {
  permanentTabs,
  selectedTabId,
  tabs,
} from "../../tabs/state";
import { closeRepoManagementTab, openNewTab } from "../../tabs/ops";
import { performTabOperation } from "../../tabs/dispatcher";
import {
  NEW_TAB_BUTTON_ID,
  PERMANENT_REPO_MANAGEMENT_ID,
} from "../../tabs/types";
import { TabPill } from "./TabPill";

export function TabBar() {
  const onSelect = (id: string) =>
    void performTabOperation({ type: "SWITCH_TO", tabId: id });

  const onClose = (id: string) =>
    void performTabOperation({ type: "CLOSE", tabId: id });

  const onSelectPermanent = () =>
    void performTabOperation({
      type: "SWITCH_TO",
      tabId: PERMANENT_REPO_MANAGEMENT_ID,
    });

  const onClosePermanent = (e: MouseEvent) => {
    e.stopPropagation();
    void closeRepoManagementTab();
  };

  return (
    <div class="tabs__strip" role="tablist">
      <Show when={permanentTabs().repoManagement?.closed === false}>
        <div
          class="tab tab--permanent"
          classList={{
            "is-active":
              selectedTabId() === PERMANENT_REPO_MANAGEMENT_ID,
          }}
          role="tab"
          aria-selected={selectedTabId() === PERMANENT_REPO_MANAGEMENT_ID}
          title="Repo Management"
          onMouseDown={onSelectPermanent}
        >
          <span class="tab__title">Repo Management</span>
          {/* Permanent tabs DO close — the per-pill × stays visible
              because closeRepoManagementTab uses LOAD_TABS to flip the
              `closed` flag without entering closedTabs. */}
          <button
            class="tab__close"
            type="button"
            aria-label="Close Repo Management"
            title="Close"
            onClick={onClosePermanent}
            style="opacity: 1"
          >
            <span aria-hidden>×</span>
          </button>
        </div>
      </Show>

      <For each={tabs()}>
        {(tab) => (
          <TabPill
            tab={tab}
            isActive={selectedTabId() === tab.id}
            onSelect={onSelect}
            onClose={onClose}
          />
        )}
      </For>

      <button
        id={NEW_TAB_BUTTON_ID}
        class="tabs__new"
        type="button"
        aria-label="New tab"
        title="New tab (Ctrl+T)"
        onClick={() => void openNewTab()}
      >
        <IconPlus />
      </button>

      <button
        class="tabs__dropdown"
        type="button"
        aria-label="Tab menu"
        title="Tab menu (wired in #206)"
        disabled
      >
        <IconChevronDown />
      </button>
    </div>
  );
}
