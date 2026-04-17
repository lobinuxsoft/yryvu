// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * 32-colour palette (RGB 0..1), matches `graph-core`'s `palette_size = 32`.
 * Hand-picked for distinguishability on a dark background while keeping stable
 * assignments via `blake3(sha) % 32`.
 */
export const PALETTE: Float32Array = new Float32Array([
  0.93, 0.42, 0.45, // red
  0.96, 0.57, 0.29, // orange
  0.95, 0.77, 0.29, // amber
  0.82, 0.88, 0.33, // lime
  0.49, 0.84, 0.47, // green
  0.32, 0.78, 0.63, // teal
  0.34, 0.74, 0.84, // cyan
  0.35, 0.60, 0.92, // blue
  0.53, 0.47, 0.95, // indigo
  0.72, 0.45, 0.94, // violet
  0.91, 0.45, 0.87, // magenta
  0.95, 0.48, 0.66, // pink
  0.74, 0.55, 0.40, // tan
  0.56, 0.69, 0.47, // moss
  0.40, 0.65, 0.72, // slate cyan
  0.67, 0.51, 0.76, // mauve
  0.88, 0.35, 0.35,
  0.86, 0.50, 0.26,
  0.85, 0.70, 0.23,
  0.70, 0.80, 0.25,
  0.36, 0.75, 0.38,
  0.22, 0.69, 0.55,
  0.22, 0.64, 0.77,
  0.27, 0.53, 0.85,
  0.45, 0.41, 0.88,
  0.65, 0.39, 0.87,
  0.84, 0.37, 0.80,
  0.88, 0.40, 0.58,
  0.65, 0.47, 0.34,
  0.47, 0.61, 0.40,
  0.32, 0.58, 0.65,
  0.58, 0.43, 0.69,
]);

export const PALETTE_SIZE = 32;
