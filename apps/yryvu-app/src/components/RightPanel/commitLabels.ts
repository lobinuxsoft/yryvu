// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Label for the commit panel's primary action button (#151 item E).
 *
 * GitKraken picks it from a 12-branch `_.cond` (bundle 7570400); the
 * branches reachable in yryvu are the last three plus the two
 * disabled-state ones, evaluated in GK's order — the staged-files check
 * comes before the message check, so an empty panel reads
 * "Stage Changes to Commit" rather than "Type a Message to Commit".
 *
 * Deliberately dropped: GK's `" and Push"` and `" (Skip Hooks)"`
 * suffixes. yryvu's push-after-commit is a separate item on the split
 * button rather than a checkbox that arms the primary action, and its
 * skip-hooks toggle is a no-op on the current backend
 * (`repo/staging/types.rs`) — advertising either in the label would
 * promise behaviour the button does not have.
 */

export interface CommitLabelState {
  stagedCount: number;
  amending: boolean;
  hasMessage: boolean;
}

export function commitButtonLabel(state: CommitLabelState): string {
  if (state.stagedCount === 0 && !state.amending) {
    return "Stage Changes to Commit";
  }
  if (!state.hasMessage) return "Type a Message to Commit";
  if (state.amending) return "Amend Previous Commit";
  return state.stagedCount === 1
    ? "Commit Changes to 1 File"
    : `Commit Changes to ${state.stagedCount} Files`;
}
