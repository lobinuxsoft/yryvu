// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BranchOpsState } from "../state";

import { createBranchHandlers } from "./branch";
import { createCheckoutHandlers } from "./checkout";
import { createGitflowHandlers } from "./gitflow";
import { createMergeHandlers } from "./merge";
import { createRefHandlers } from "./refs";
import { createRemoteHandlers } from "./remote";
import { createSubmoduleHandlers } from "./submodule";
import { createTagHandlers } from "./tags";

export interface HandlersDeps {
  state: BranchOpsState;
  refresh: () => void;
}

/**
 * Composes the per-domain handler bundles into one flat object so the
 * orchestrator (`branchOps/index.tsx`) doesn't need to know about the
 * sub-files. Each sub-bundle takes the same `(state, refresh)` pair —
 * splitting is purely organizational; runtime behaviour is unchanged.
 */
export function createHandlers(deps: HandlersDeps) {
  return {
    ...createCheckoutHandlers(deps),
    ...createRefHandlers(deps),
    ...createBranchHandlers(deps),
    ...createMergeHandlers(deps),
    ...createSubmoduleHandlers(deps),
    ...createRemoteHandlers(deps),
    ...createTagHandlers(deps),
    ...createGitflowHandlers(deps),
  };
}

export type Handlers = ReturnType<typeof createHandlers>;
