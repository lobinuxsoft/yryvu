// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, onMount, type JSX } from "solid-js";
import { ConnectionForm } from "./ConnectionForm";
import { SubTabSidebar } from "./SubTabSidebar";
import { findProvider, PROVIDERS, type IntegrationType } from "./providerTable";
import { hydrateHostname } from "./selfHostedHostnames";
import { hydrateConfigured, hydrateConnectedState } from "./tokenStorage";
import { listConfiguredIntegrations } from "../../../../ipc";

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
  const [active, setActive] = createSignal<IntegrationType>(PROVIDERS[0].type);
  const provider = () => findProvider(active());

  onMount(() => {
    void (async () => {
      // Sequential: hydrateConfigured first so the indicator dots
      // light up immediately; per-provider preflight runs after and
      // populates the real UserInfo lazily.
      await hydrateConfigured();
      for (const p of PROVIDERS) {
        if (p.isSelfHosted) {
          void hydrateHostname(p.type);
        }
      }
      const configured = await listConfiguredIntegrations().catch(
        () => [] as string[],
      );
      for (const type of configured) {
        void hydrateConnectedState(type as IntegrationType);
      }
    })();
  });

  return (
    <div class="integrations">
      <SubTabSidebar active={active()} onSelect={setActive} />
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
