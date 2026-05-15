// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, Show } from "solid-js";

import { Markdown } from "../PullRequestDetail/markdownRender";

interface MarkdownEditorProps {
  value: string;
  onInput: (next: string) => void;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
  /// Optional id for the textarea — pairs with a `<label for=...>`
  /// in the surrounding form.
  textareaId?: string;
}

/// Markdown-aware text editor — "Write" tab is the plain textarea,
/// "Preview" tab renders the current value through the shared
/// markdown pipeline. Mirrors GitHub / GK's comment composer shape so
/// users can sanity-check formatting before submitting.
export function MarkdownEditor(props: MarkdownEditorProps) {
  const [mode, setMode] = createSignal<"write" | "preview">("write");
  return (
    <div class="md-editor">
      <div class="md-editor__tabs">
        <button
          type="button"
          class="md-editor__tab"
          data-active={mode() === "write" ? "true" : "false"}
          onClick={() => setMode("write")}
        >
          Write
        </button>
        <button
          type="button"
          class="md-editor__tab"
          data-active={mode() === "preview" ? "true" : "false"}
          onClick={() => setMode("preview")}
        >
          Preview
        </button>
      </div>
      <Show
        when={mode() === "write"}
        fallback={
          <div class="md-editor__preview">
            <Show
              when={props.value.trim().length > 0}
              fallback={<p class="md-editor__empty">Nothing to preview.</p>}
            >
              <Markdown source={props.value} />
            </Show>
          </div>
        }
      >
        <textarea
          id={props.textareaId}
          class="md-editor__textarea"
          rows={props.rows ?? 6}
          value={props.value}
          placeholder={props.placeholder}
          disabled={props.disabled}
          onInput={(e) => props.onInput(e.currentTarget.value)}
        />
      </Show>
    </div>
  );
}
