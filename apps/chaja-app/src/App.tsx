// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, Show } from "solid-js";

import { CommitGraph } from "./components/CommitGraph";
import "./App.css";

function App() {
  const [repoPath, setRepoPath] = createSignal<string>("");
  const [submitted, setSubmitted] = createSignal<string | undefined>(undefined);

  return (
    <main class="app">
      <header class="app__header">
        <h1>chajá</h1>
        <form
          class="app__repo-form"
          onSubmit={(e) => {
            e.preventDefault();
            const v = repoPath().trim();
            if (v) setSubmitted(v);
          }}
        >
          <input
            class="app__repo-input"
            placeholder="/path/to/repo"
            value={repoPath()}
            onInput={(e) => setRepoPath(e.currentTarget.value)}
          />
          <button type="submit">Open</button>
        </form>
      </header>
      <section class="app__body">
        <Show when={submitted()} fallback={<p class="app__hint">Open a repo to render its graph.</p>}>
          <CommitGraph repoPath={submitted()!} />
        </Show>
      </section>
    </main>
  );
}

export default App;
