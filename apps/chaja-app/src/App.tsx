// SPDX-License-Identifier: AGPL-3.0-or-later

import { createSignal, Show } from "solid-js";
import { open } from "@tauri-apps/plugin-dialog";

import { CommitGraph } from "./components/CommitGraph";
import "./App.css";

function App() {
  const [repoPath, setRepoPath] = createSignal<string | undefined>(undefined);

  async function pickRepo() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open a Git repository",
    });
    if (typeof selected === "string") setRepoPath(selected);
  }

  return (
    <main class="app">
      <header class="app__header">
        <h1>chajá</h1>
        <div class="app__repo-form">
          <span class="app__repo-path" title={repoPath() ?? ""}>
            {repoPath() ?? "No repository selected"}
          </span>
          <button type="button" onClick={pickRepo}>
            Open repo…
          </button>
        </div>
      </header>
      <section class="app__body">
        <Show when={repoPath()} fallback={<p class="app__hint">Open a repo to render its graph.</p>}>
          <CommitGraph repoPath={repoPath()!} />
        </Show>
      </section>
    </main>
  );
}

export default App;
