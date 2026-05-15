// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, Show } from "solid-js";

interface SectionProps {
  title: string;
  /// Optional count rendered after the title (e.g. "Commits 3").
  count?: number | string;
  /// Open on first mount. Defaults to true.
  defaultOpen?: boolean;
  children: any;
}

/// Collapsible stacked section for the PR detail main column. Mirrors
/// GK's pinned-header pattern (Description / Commits / Files / Checks
/// rendered as vertically stacked collapsibles, not tabs).
export function Section(props: SectionProps) {
  const [open, setOpen] = createSignal(props.defaultOpen ?? true);
  return (
    <section class="pr-detail__section">
      <button
        type="button"
        class="pr-detail__section-header"
        data-open={open() ? "true" : "false"}
        onClick={() => setOpen(!open())}
      >
        <span class="pr-detail__section-chevron">{open() ? "▾" : "▸"}</span>
        <span class="pr-detail__section-title">{props.title}</span>
        <Show when={props.count !== undefined}>
          <span class="pr-detail__section-count">{props.count}</span>
        </Show>
      </button>
      <Show when={open()}>
        <div class="pr-detail__section-body">{props.children}</div>
      </Show>
    </section>
  );
}
