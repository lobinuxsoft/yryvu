// SPDX-License-Identifier: AGPL-3.0-or-later

import { openUrl } from "@tauri-apps/plugin-opener";
import { createEffect, createSignal, type JSX, Show } from "solid-js";
import { SolidMarkdown } from "solid-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

import { notify } from "../Notifications";
import { FileContentView } from "./FullFileView";
import { highlightCodeBlocks } from "./highlight";
import { classifyLink, LINK_BLOCKED_MESSAGE } from "./markdownLinks";

type MarkdownMode = "code" | "preview";

interface MarkdownViewProps {
  /// Raw Markdown source (the File View "after" content).
  content: string;
  /// hljs language for the Code view, already resolved by the caller.
  language?: string;
}

function handleLinkClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null;
  const anchor = target?.closest("a");
  if (!anchor) return;
  const href = anchor.getAttribute("href") ?? "";
  const action = classifyLink(href);
  if (action === "anchor") return;
  event.preventDefault();
  if (action === "external") {
    void openUrl(href);
    return;
  }
  notify.info("Link blocked", { message: LINK_BLOCKED_MESSAGE });
}

/// Markdown Code / Preview toggle for File View (issue #60, doc 08).
/// `.md` / `.markdown` / `.mdx` files get a binary toggle: Code shows the
/// raw source via the shared file content renderer, Preview runs the
/// unified/remark/rehype pipeline. Diff mode never reaches here — it
/// always shows the raw Markdown source.
export function MarkdownView(props: MarkdownViewProps): JSX.Element {
  const [mode, setMode] = createSignal<MarkdownMode>("preview");
  let previewRef: HTMLDivElement | undefined;

  // Re-highlight fenced code blocks with the shared hljs instance after
  // each render. queueMicrotask defers until SolidMarkdown's DOM is in.
  createEffect(() => {
    if (mode() !== "preview") return;
    props.content;
    queueMicrotask(() => {
      if (previewRef) highlightCodeBlocks(previewRef);
    });
  });

  return (
    <div class="markdown-view">
      <div class="markdown-view__toolbar" role="group" aria-label="Markdown view">
        <button
          type="button"
          class="markdown-view__toggle"
          data-testid="markdown-code"
          aria-pressed={mode() === "code"}
          onClick={() => setMode("code")}
        >
          Code
        </button>
        <button
          type="button"
          class="markdown-view__toggle"
          data-testid="markdown-preview"
          aria-pressed={mode() === "preview"}
          onClick={() => setMode("preview")}
        >
          Preview
        </button>
      </div>

      <Show
        when={mode() === "preview"}
        fallback={<FileContentView content={props.content} language={props.language} />}
      >
        <div
          class="markdown-view__preview"
          ref={previewRef}
          onClick={handleLinkClick}
        >
          <SolidMarkdown
            class="markdown-body"
            children={props.content}
            remarkPlugins={[remarkGfm, remarkBreaks]}
            rehypePlugins={[rehypeSanitize]}
            transformLinkUri={null}
          />
        </div>
      </Show>
    </div>
  );
}
