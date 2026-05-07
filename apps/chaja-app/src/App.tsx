// SPDX-License-Identifier: AGPL-3.0-or-later

import { AppShell } from "./components/AppShell";
import { mountThemeProvider } from "./themes";
import "./styles/index.css";
import "highlight.js/styles/github-dark.css";

function App() {
  mountThemeProvider();
  return <AppShell />;
}

export default App;
