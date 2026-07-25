// SPDX-License-Identifier: AGPL-3.0-or-later

import { AppShell } from "./components/AppShell";
import { mountRepoLiveRefresh } from "./state/repo-live";
import { mountSshTofuListener } from "./state/ssh-tofu";
import { mountThemeProvider } from "./themes";
import { mountZoomProvider } from "./zoom";
import "./styles/index.css";
import "highlight.js/styles/github-dark.css";

function App() {
  mountThemeProvider();
  mountZoomProvider();
  void mountRepoLiveRefresh();
  void mountSshTofuListener();
  return <AppShell />;
}

export default App;
