// SPDX-License-Identifier: AGPL-3.0-or-later

import { AppShell } from "./components/AppShell";
import { mountThemeProvider } from "./themes";
import { mountZoomProvider } from "./zoom";
import "./styles/index.css";
import "highlight.js/styles/github-dark.css";

function App() {
  mountThemeProvider();
  mountZoomProvider();
  return <AppShell />;
}

export default App;
