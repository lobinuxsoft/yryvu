// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, type Accessor } from "solid-js";
import type { IntegrationType } from "./providerTable";

/**
 * Per-integration finite state. Discriminated union mirroring the shape
 * recommended in `docs/research/gitkraken-integrations/10-yryvu-implementation-hints.md`.
 *
 * Keeping the union shape now (instead of flat booleans) avoids the
 * v3-refactor trap when real OAuth lands.
 */
export type IntegrationState =
  | { tag: "disconnected"; reason?: "user_initiated" | "token_revoked" | "refresh_failed" }
  | { tag: "connecting" }
  | {
      tag: "connected";
      user: { displayName: string; login: string; avatarUrl?: string };
    }
  | { tag: "disconnecting" };

const SIGNALS = new Map<
  IntegrationType,
  ReturnType<typeof createSignal<IntegrationState>>
>();

function getSignal(type: IntegrationType) {
  let entry = SIGNALS.get(type);
  if (!entry) {
    entry = createSignal<IntegrationState>({ tag: "disconnected" });
    SIGNALS.set(type, entry);
  }
  return entry;
}

export function integrationState(type: IntegrationType): Accessor<IntegrationState> {
  return getSignal(type)[0];
}

export function setIntegrationState(
  type: IntegrationType,
  next: IntegrationState,
): void {
  getSignal(type)[1](next);
}
