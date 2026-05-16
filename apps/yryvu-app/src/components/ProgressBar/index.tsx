// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show, type JSX } from "solid-js";

import "../../styles/progress-bar.css";

export interface ProgressBarProps {
  /// Heading shown above the bar — e.g. `"Receiving objects"` or
  /// `"Pushing"`. Pair with [`current`] / [`total`] for an inline
  /// counter.
  label: string;
  /// 0–100 fill percentage. Clamped on render so callers can pass
  /// raw division results without bounds-checking. Ignored when
  /// [`indeterminate`] is true.
  percent: number;
  /// Optional fraction shown next to the percent (e.g.
  /// `"(1234 / 5678)"`). Hidden when `total` is `0` / `undefined` so
  /// callers can pass through raw libgit2 / network counters without
  /// branching on availability.
  current?: number;
  total?: number;
  /// Indeterminate mode — animated barberpole when the underlying
  /// operation hasn't reported a percent yet (e.g. clone "Starting"
  /// phase, blocking IPC waits). Frees the caller from inventing a
  /// fake percent for the unknown-progress phase.
  indeterminate?: boolean;
  /// Optional accent override — defaults to the global `--accent`
  /// CSS var. Pass a hex / CSS color when a specific operation
  /// wants a different visual identity (e.g. red for revert, blue
  /// for fetch).
  accent?: string;
}

/// Reusable progress bar with optional `current/total` counter +
/// indeterminate mode. Drop-in replacement for any ad-hoc
/// `width: ${percent}%` div that used to live inside specific
/// components. Used across the app for clone (#374), and reusable
/// for any future long-running operation that streams progress
/// (push / pull / fetch / format-patch / etc.).
export function ProgressBar(props: ProgressBarProps): JSX.Element {
  const clamped = (): number => {
    if (props.indeterminate) return 100;
    const raw = props.percent;
    if (!Number.isFinite(raw)) return 0;
    if (raw < 0) return 0;
    if (raw > 100) return 100;
    return raw;
  };
  const showCounter = (): boolean =>
    !props.indeterminate &&
    typeof props.total === "number" &&
    props.total > 0 &&
    typeof props.current === "number";
  const barStyle = (): JSX.CSSProperties => {
    const style: JSX.CSSProperties = { width: `${clamped()}%` };
    if (props.accent) {
      // CSS var override — prefer the var so theme cascading still
      // applies (hover states, hi-contrast modes).
      (style as Record<string, string>)["background"] = props.accent;
    }
    return style;
  };
  return (
    <div class="progress-bar">
      <div class="progress-bar__label">
        {props.label}
        <Show when={!props.indeterminate}> — {Math.round(clamped())}%</Show>
        <Show when={showCounter()}>
          <span class="progress-bar__counter">
            {" "}
            ({props.current} / {props.total})
          </span>
        </Show>
      </div>
      <div
        class="progress-bar__track"
        classList={{ "progress-bar__track--indeterminate": !!props.indeterminate }}
      >
        <div class="progress-bar__fill" style={barStyle()} />
      </div>
    </div>
  );
}
