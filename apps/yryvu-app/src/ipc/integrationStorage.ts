// SPDX-License-Identifier: AGPL-3.0-or-later

//! IPC surface for the integrations subsystem (credentials, PRs, issues,
//! comments, selectors, clone candidates, create flows, OAuth). Split into
//! domain modules under `./integrations/`; this barrel re-exports them so
//! existing `from "../ipc"` / `from "./integrationStorage"` imports keep
//! working without touching call sites.

export * from "./integrations/credentials";
export * from "./integrations/pulls";
export * from "./integrations/issues";
export * from "./integrations/comments";
export * from "./integrations/selectors";
export * from "./integrations/clone";
export * from "./integrations/create";
export * from "./integrations/oauth";
