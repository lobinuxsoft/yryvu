// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, onMount, type JSX } from "solid-js";
import { ConnectionForm } from "./ConnectionForm";
import { SubTabSidebar } from "./SubTabSidebar";
import { findProvider, PROVIDERS, type IntegrationType } from "./providerTable";
import { hydrateIntegrationsOnAppStart } from "./tokenStorage";

/// Module-scoped active sub-tab signal so external callers (Clone
/// dialog's "Connect to <Provider>" CTA, deep-links) can pre-select
/// a provider before the panel mounts.
const [activeProvider, setActiveProvider] = createSignal<IntegrationType>(
  PROVIDERS[0].type,
);

/// Pre-select the Integrations sub-tab. Pair with `openPreferences("integrations")`
/// to land on a specific provider's connection form.
export function setActiveIntegrationProvider(type: IntegrationType): void {
  setActiveProvider(type);
}

/**
 * Preferences > Integrations panel root. Composes the provider
 * sub-tab sidebar (left) with the active provider's connection form
 * (right).
 *
 * `bundle:119167` — the canonical Integrations tab. Sub-tab order
 * comes from `orderedIntegrationSubTabTypes` (`bundle:119112`)
 * mirrored verbatim in `providerTable.ts`.
 *
 * Active sub-tab is local-only state — no persistence across sessions
 * yet. When the cluster grows real connections, lift to
 * `state/preferences.ts` so reopening Preferences lands on the
 * last-visited provider.
 *
 * **Hydration**: on mount, fetch the list of configured integrations
 * and the saved hostnames for self-hosted variants from the backend
 * sidecar so the UI reflects the persisted state. Tokens themselves
 * stay in the OS keyring; this panel never holds them.
 */
export function IntegrationsPanel(): JSX.Element {
  const provider = () => findProvider(activeProvider());

  // App start already hydrated integration states in `AppShell.onMount`
  // via `hydrateIntegrationsOnAppStart`. Re-run here as a refresh hook
  // for users who connect/disconnect during a long-lived session and
  // want the panel reflecting the latest sidecar + keyring state.
  onMount(() => {
    void hydrateIntegrationsOnAppStart();
  });

  return (
    <div class="integrations">
      <SubTabSidebar active={activeProvider()} onSelect={setActiveProvider} />
      <section
        class="integrations__pane"
        role="tabpanel"
        aria-label={provider().verboseLabel}
      >
        <ConnectionForm provider={provider()} />
      </section>
    </div>
  );
}
