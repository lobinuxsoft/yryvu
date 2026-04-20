// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * 10-colour lane palette (RGB 0..1).
 *
 * The colours mirror the GitKraken commit graph research (see
 * `docs/research/gitkraken-graph/09-color-palette.md`). They are also exposed
 * as CSS custom properties `--column-0-color` .. `--column-9-color` on the
 * `.main` block so themes can override them at the stylesheet layer; the
 * array here is kept for WebGL upload and must stay in sync.
 *
 * Assignment is by column index (`color_idx = lane_idx % PALETTE_SIZE`), not
 * sha — a branch that lives on column 3 is always magenta regardless of
 * which commits occupy it.
 */
// Must be a plain number[] (not Float32Array) so that OGL's array-uniform
// detection (`Array.isArray(uniform.value)`) matches and the palette is
// actually uploaded with `uniform3fv`. Using a Float32Array here silently
// fails the array check and every node/edge renders with zero colour.
export const PALETTE: number[] = [
  0.082, 0.627, 0.749, // 0 — teal cyan   #15a0bf
  0.024, 0.412, 0.969, // 1 — blue        #0669f7
  0.557, 0.000, 0.761, // 2 — purple      #8e00c2
  0.773, 0.090, 0.714, // 3 — magenta     #c517b6
  0.851, 0.004, 0.443, // 4 — pink        #d90171
  0.804, 0.004, 0.004, // 5 — red         #cd0101
  0.949, 0.365, 0.180, // 6 — orange      #f25d2e
  0.949, 0.792, 0.200, // 7 — yellow      #f2ca33
  0.482, 0.851, 0.220, // 8 — green       #7bd938
  0.180, 0.808, 0.616, // 9 — mint        #2ece9d
];

export const PALETTE_SIZE = 10;
