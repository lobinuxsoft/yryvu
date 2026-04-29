// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from "solid-js";
import { Placeholder } from "./Placeholder";

/**
 * UI preferences panel — theme, density, color palette, font scale.
 * Stub for the shell sub-PR; concrete settings land via #103.
 */
export function UiPanel(): JSX.Element {
  return Placeholder({ section: "UI", issue: 103 });
}
