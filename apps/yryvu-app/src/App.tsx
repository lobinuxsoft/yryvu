// SPDX-License-Identifier: AGPL-3.0-or-later

import { AppShell } from "./components/AppShell";
import { mountRepoLiveRefresh } from "./state/repo-live";
import { mountThemeProvider } from "./themes";
import { mountZoomProvider } from "./zoom";
import "./styles/index.css";
import "highlight.js/styles/github-dark.css";

function App() {
  mountThemeProvider();
  mountZoomProvider();
  void mountRepoLiveRefresh();
  return <AppShell />;
}

export default App;
