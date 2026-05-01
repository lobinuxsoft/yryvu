// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, type JSX } from "solid-js";
import { ConnectionForm } from "./ConnectionForm";
import { SubTabSidebar } from "./SubTabSidebar";
import { findProvider, PROVIDERS, type IntegrationType } from "./providerTable";

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
 */
export function IntegrationsPanel(): JSX.Element {
  const [active, setActive] = createSignal<IntegrationType>(PROVIDERS[0].type);
  const provider = () => findProvider(active());

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
