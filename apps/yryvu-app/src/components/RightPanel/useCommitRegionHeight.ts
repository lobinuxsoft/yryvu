// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Sizing for the WIP panel's commit region — the block below the
 * splitter holding the message fields and the commit button (#151).
 *
 * GitKraken drives the same boundary with `<Resizable resizeEdge="top">`
 * (bundle 270020): the region has a floor of 275 px, 25 more while
 * Commit options is expanded, and a ceiling of `panelHeight - 249` so
 * the staging lists above always keep a usable slice.
 *
 * The stored height is the user's *intention* and is never overwritten
 * by a clamp — a short window narrows the region on screen, and growing
 * the window restores what the user asked for. (Persisting the clamp is
 * how #37 lost graph-column widths on reload.)
 */

import { createSignal, onCleanup } from "solid-js";

import {
  clampCommitRegionHeight,
  COMMIT_OPTIONS_EXTRA_HEIGHT,
  commitRegionHeight,
  MIN_COMMIT_REGION_HEIGHT,
} from "../../state/detail-panel-layout";

/// Space kept for everything above the splitter. GK reserves
/// `31 + 218` (bundle 6554000); yryvu's own chrome needs about as much
/// — panel header, toolbar and the two 120 px section floors — so the
/// same number holds without inventing a second one.
const RESERVED_ABOVE = 249;

export function useCommitRegionHeight(optionsExpanded: () => boolean) {
  const [panelHeight, setPanelHeight] = createSignal(0);

  let observer: ResizeObserver | undefined;

  /// Ref callback for the panel element. Measured live because the
  /// ceiling has to follow window resizes, not just drags.
  const observePanel = (el: HTMLElement) => {
    setPanelHeight(el.clientHeight);
    observer = new ResizeObserver(() => setPanelHeight(el.clientHeight));
    observer.observe(el);
  };

  onCleanup(() => observer?.disconnect());

  const minHeight = () =>
    MIN_COMMIT_REGION_HEIGHT +
    (optionsExpanded() ? COMMIT_OPTIONS_EXTRA_HEIGHT : 0);

  /// Ceiling for the current panel height. Before the first measurement
  /// (`panelHeight === 0`) this would read as a hard floor and snap the
  /// region to its minimum for one frame, so an unmeasured panel yields
  /// `Infinity` instead: an unmeasured panel is not a short one.
  const maxHeight = () =>
    panelHeight() === 0 ? Infinity : panelHeight() - RESERVED_ABOVE;

  /// What actually gets rendered: the stored intention, clamped.
  const height = () =>
    clampCommitRegionHeight(commitRegionHeight(), maxHeight(), minHeight());

  return { observePanel, height, minHeight, maxHeight };
}
