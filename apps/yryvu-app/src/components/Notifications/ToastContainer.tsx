// SPDX-License-Identifier: AGPL-3.0-or-later

import { For } from "solid-js";
import { Portal } from "solid-js/web";

import { activeToasts } from "./store";
import { Toast } from "./Toast";

/**
 * Top-level toast stack. Mounts via Portal to escape any ancestor
 * `overflow: hidden` (the AppShell grid clips them otherwise). Newest
 * toast renders at the top of the stack, matching GitKraken's
 * prepend-on-push reducer (`/tmp/gk-bundle-pretty.js:156983`).
 */
export function ToastContainer() {
  return (
    <Portal>
      <div class="toast-stack" role="region" aria-label="Notifications">
        <For each={activeToasts()}>{(item) => <Toast item={item} />}</For>
      </div>
    </Portal>
  );
}
