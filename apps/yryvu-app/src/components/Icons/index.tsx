// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Inline-SVG icon barrel. The icons themselves live in sibling files
 * grouped by domain (git / status / actions / chrome / preferences) so
 * each module stays under the 400 LoC monolith cap. Consumers keep
 * importing from `"../Icons"` and get the same surface.
 *
 * Split from a 460 LoC single file in #347.
 */

export type { IconProps } from "./_base";

export * from "./git";
export * from "./status";
export * from "./actions";
export * from "./chrome";
export * from "./diff_view";
export * from "./preferences";
