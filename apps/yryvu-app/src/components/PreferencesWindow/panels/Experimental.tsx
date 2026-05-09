// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from "solid-js";
import { Placeholder } from "./Placeholder";

/**
 * Experimental preferences panel — opt-in flags for incomplete features.
 * Stub for the shell sub-PR; concrete settings land via #107.
 */
export function ExperimentalPanel(): JSX.Element {
  return Placeholder({ section: "Experimental", issue: 107 });
}
