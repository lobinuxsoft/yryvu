// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

/**
 * Raw repo-path signal. Lives in its own file so the refresh resources
 * and the cleanup orchestrator (`setRepoPath` in `state/repo.ts`) can
 * both depend on it without inducing a top-level import cycle.
 *
 * Public reads go through the `repoPath` re-export in `state/index.ts`;
 * the only writer outside this file is `setRepoPath`, which clears every
 * per-repo signal before writing through `setRepoPathRaw`.
 */
const [repoPath, setRepoPathRaw] = createSignal<string | undefined>(undefined);

export { repoPath, setRepoPathRaw };
