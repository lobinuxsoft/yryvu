// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, onCleanup, Show, type JSX } from "solid-js";
import { Portal } from "solid-js/web";

import { preferences } from "../../state/preferences";

import "../../styles/tooltip.css";

export type TooltipPosition = "top" | "bottom" | "left" | "right";

export interface TooltipProps {
  /// Tooltip text. `null` / `undefined` / empty string disables the
  /// bubble entirely (children render unchanged) — lets call sites
  /// pass a conditional accessor without branching markup.
  text?: string | null;
  /// Where the bubble appears relative to the anchor. Defaults to
  /// `"bottom"` to match GK's hover convention.
  position?: TooltipPosition;
  /// The element the tooltip describes. Wrapped in a
  /// `display: contents` span so layout is unaffected; events bubble
  /// from the child to the wrapper, the wrapper's ref reads the
  /// first child's bounding rect for positioning.
  children: JSX.Element;
}

const HIDE_MARGIN = 6;

/// Reusable tooltip mirror of GK's hover-bubble (`bundle:248913`).
/// Reads `tooltipsEnabled` + `tooltipDelayMs` from the global
/// preferences signal so toggling either reflects on next hover
/// without per-site rewires.
///
/// A11y: `aria-label` is set on the wrapper regardless of whether
/// the visual bubble is enabled, so screen readers always pick up
/// the hint text. The bubble itself carries `role="tooltip"`.
export function Tooltip(props: TooltipProps): JSX.Element {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let anchorEl: HTMLSpanElement | undefined;
  const [visible, setVisible] = createSignal(false);
  const [coords, setCoords] = createSignal<{ x: number; y: number } | null>(
    null,
  );

  const text = (): string => (props.text ?? "").trim();
  const enabled = (): boolean =>
    !!preferences()?.ui.tooltipsEnabled && text().length > 0;
  const delayMs = (): number => preferences()?.ui.tooltipDelayMs ?? 500;

  const compute = () => {
    if (!anchorEl) return;
    // The wrapper is `display: contents`, so its own bounding rect
    // collapses to 0×0. Read the first child's rect — that's the
    // actual visible element being hinted.
    const child = anchorEl.firstElementChild as HTMLElement | null;
    const rect = (child ?? anchorEl).getBoundingClientRect();
    const pos = props.position ?? "bottom";
    let x = rect.left + rect.width / 2;
    let y = rect.bottom + HIDE_MARGIN;
    if (pos === "top") y = rect.top - HIDE_MARGIN;
    if (pos === "left") {
      x = rect.left - HIDE_MARGIN;
      y = rect.top + rect.height / 2;
    }
    if (pos === "right") {
      x = rect.right + HIDE_MARGIN;
      y = rect.top + rect.height / 2;
    }
    setCoords({ x, y });
  };

  const showAfterDelay = () => {
    if (!enabled()) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      compute();
      setVisible(true);
    }, delayMs());
  };

  const hideNow = () => {
    clearTimeout(timer);
    setVisible(false);
  };

  onCleanup(() => clearTimeout(timer));

  // The wrapper has no box (display: contents); pointer + focus
  // events still bubble from the child so the listeners attached
  // here drive the hover/focus delay.
  return (
    <span
      class="tooltip-anchor"
      ref={(el) => (anchorEl = el)}
      onMouseEnter={showAfterDelay}
      onMouseLeave={hideNow}
      onFocusIn={showAfterDelay}
      onFocusOut={hideNow}
      aria-label={text() || undefined}
    >
      {props.children}
      <Show when={visible() && coords() && enabled()}>
        <Portal>
          <span
            class="tooltip"
            classList={{ [`tooltip--${props.position ?? "bottom"}`]: true }}
            style={{
              left: `${coords()!.x}px`,
              top: `${coords()!.y}px`,
            }}
            role="tooltip"
          >
            {text()}
          </span>
        </Portal>
      </Show>
    </span>
  );
}
