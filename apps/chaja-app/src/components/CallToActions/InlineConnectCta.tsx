// SPDX-License-Identifier: AGPL-3.0-or-later

import { type JSX } from "solid-js";
import { openPreferences } from "../../state";

/**
 * Reusable "Connect a Git provider" inline CTA. Mirror of GK's
 * `Services-ServiceNotConnected` body + `RemoteForm-ConnectToService`
 * button copy spirit (see `docs/research/gitkraken-integrations/07-connection-required-prompts.md`).
 *
 * Used today by:
 * - LeftSidebar PR section empty state
 * - LeftSidebar ISSUES section empty state
 *
 * Future surfaces (audit doc 07 catalogue) reuse the same component:
 * PR slidey panel `hosting-service-not-connected` empty state, NewTab
 * welcome widget, etc. — they land when their host surfaces exist in
 * chajá.
 *
 * **chajá deviation**: this CTA does NOT pre-select an Integrations
 * sub-tab for the relevant provider — chajá lacks a remote → provider
 * mapping until the backend foundation lands. Click drops the user on
 * the last-visited Integrations sub-tab (or GitHub on first visit).
 * Lift the active sub-tab to global state once the mapping exists.
 */
export function InlineConnectCta(props: {
  kind: "pull-requests" | "issues";
}): JSX.Element {
  const description = () =>
    props.kind === "pull-requests"
      ? "Connect a Git provider to list pull requests."
      : "Connect a Git provider to list issues.";

  return (
    <div class="inline-connect-cta">
      <p class="inline-connect-cta__body">{description()}</p>
      <button
        class="inline-connect-cta__button"
        type="button"
        onClick={() => openPreferences("integrations")}
      >
        Connect
      </button>
    </div>
  );
}
