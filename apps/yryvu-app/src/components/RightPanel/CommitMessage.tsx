// SPDX-License-Identifier: AGPL-3.0-or-later

import { For } from "solid-js";

const SUBJECT_LIMIT = 72;

const CONVENTIONAL_TYPES = [
  "feat",
  "fix",
  "docs",
  "chore",
  "refactor",
  "test",
  "ci",
  "style",
  "perf",
  "build",
  "revert",
] as const;

function applyConventionalPrefix(current: string, type: string): string {
  const stripped = current.replace(/^[a-z]+(\([^)]*\))?:\s*/i, "");
  return `${type}: ${stripped}`;
}

export interface CommitMessageProps {
  summary: string;
  description: string;
  onSummaryChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
}

export function CommitMessage(props: CommitMessageProps) {
  const remaining = () => SUBJECT_LIMIT - props.summary.length;

  return (
    <div class="commit-panel__message">
      <div class="commit-panel__template">
        <label for="commit-panel-template">Template</label>
        <select
          id="commit-panel-template"
          class="commit-panel__template-select"
          value=""
          onChange={(e) => {
            const t = e.currentTarget.value;
            if (!t) return;
            props.onSummaryChange(applyConventionalPrefix(props.summary, t));
            e.currentTarget.value = "";
          }}
        >
          <option value="">Conventional…</option>
          <For each={CONVENTIONAL_TYPES}>
            {(t) => <option value={t}>{t}</option>}
          </For>
        </select>
      </div>
      <label class="commit-panel__field">
        <div class="commit-panel__label-row">
          <span>Summary</span>
          <span
            class="commit-panel__counter"
            data-overflow={remaining() < 0 ? "true" : "false"}
          >
            {remaining()}
          </span>
        </div>
        <input
          class="commit-panel__input"
          type="text"
          placeholder="Summary"
          value={props.summary}
          onInput={(e) => props.onSummaryChange(e.currentTarget.value)}
        />
      </label>
      <label class="commit-panel__field">
        <span>Description</span>
        <textarea
          class="commit-panel__textarea"
          placeholder="Optional body"
          rows="3"
          value={props.description}
          onInput={(e) => props.onDescriptionChange(e.currentTarget.value)}
        />
      </label>
    </div>
  );
}
