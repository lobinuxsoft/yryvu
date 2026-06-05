// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

/**
 * The profile whose credentials the Integrations panel is currently
 * editing. `null` targets the legacy / global namespace — used on app
 * start (before any profile is picked) and when the user has no
 * profiles. The panel's profile selector drives this; `tokenStorage`
 * and `selfHostedHostnames` read it for every scoped IPC call.
 */
export const [selectedCredentialProfileId, setSelectedCredentialProfileId] =
  createSignal<string | null>(null);
