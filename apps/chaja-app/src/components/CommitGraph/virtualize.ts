// SPDX-License-Identifier: AGPL-3.0-or-later

export interface VisibleRange {
  start: number;
  end: number;
}

const OVERSCAN = 20;

export function computeVisible(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  totalRows: number,
): VisibleRange {
  if (totalRows === 0 || rowHeight <= 0) return { start: 0, end: 0 };
  const firstVisible = Math.floor(scrollTop / rowHeight);
  const lastVisible = Math.ceil((scrollTop + viewportHeight) / rowHeight);
  const start = Math.max(0, firstVisible - OVERSCAN);
  const end = Math.min(totalRows, lastVisible + OVERSCAN);
  return { start, end };
}
