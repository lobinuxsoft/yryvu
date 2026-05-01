// SPDX-License-Identifier: AGPL-3.0-or-later

import { persistedEnum } from "./storage";

/// Toolbar Pull split-button preference. Mirrors GitKraken's
/// `pullType` profile setting (`/tmp/gk-bundle-pretty.js:10511`).
/// Backend `MergeStrategy` value the main button runs when clicked;
/// `fetch` is a chajá deviation that wraps `fetch_prune` instead of a
/// merge. `force_pull` is also chajá-specific (5th item).
export type PullType =
  | "fetch"
  | "pull_merge"
  | "pull_ff_only"
  | "pull_rebase"
  | "force_pull";

const PULL_TYPES: readonly PullType[] = [
  "fetch",
  "pull_merge",
  "pull_ff_only",
  "pull_rebase",
  "force_pull",
];

export const [pullType, setPullType] = persistedEnum<PullType>(
  "pullType",
  "pull_merge",
  PULL_TYPES,
);
