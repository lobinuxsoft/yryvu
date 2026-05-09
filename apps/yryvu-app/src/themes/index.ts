// SPDX-License-Identifier: AGPL-3.0-or-later

export { applyThemeCss, clearInjectedTheme } from "./inject";
export {
  osColorScheme,
  resolveAutoTheme,
  subscribeColorScheme,
  type ColorSchemePreference,
} from "./auto-resolver";
export {
  colorScheme,
  mountThemeProvider,
  refetchThemes,
  resolveActiveThemeId,
  themes,
  unmountThemeProvider,
} from "./state";
