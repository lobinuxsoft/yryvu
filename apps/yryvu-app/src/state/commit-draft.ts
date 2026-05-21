// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal } from "solid-js";

/// Draft commit message — two-way bound between the WIP row's input and the
/// inspector commit panel.
export const [commitMessage, setCommitMessage] = createSignal("");
export const [commitDescription, setCommitDescription] = createSignal("");
export const [amendEnabled, setAmendEnabled] = createSignal(false);

/// User intent to sign the next commit. Defaults pulled from
/// `preferences().gpg.signCommitsByDefault` on repo open; respects
/// the user's manual toggle thereafter. Cleared on successful commit.
export const [signCommitEnabled, setSignCommitEnabled] = createSignal(false);
