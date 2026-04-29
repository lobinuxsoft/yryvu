// SPDX-License-Identifier: AGPL-3.0-or-later

import type { JSX } from "solid-js";
import { Placeholder } from "./Placeholder";

/**
 * General preferences panel — startup, default repo path, telemetry, etc.
 * Stub for the shell sub-PR; concrete settings land via #102.
 */
export function GeneralPanel(): JSX.Element {
  return Placeholder({ section: "General", issue: 102 });
}
