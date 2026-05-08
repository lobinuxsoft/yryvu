// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { resolveAutoTheme } from "../auto-resolver";
import type { ThemeEntry } from "../../ipc";

const builtIn = (id: string, scheme: "dark" | "light"): ThemeEntry => ({
  id,
  name: id,
  scheme,
  builtIn: true,
});

const TEN_BUILT_INS: ThemeEntry[] = [
  builtIn("a-default", "dark"),
  builtIn("b-tokyo-night", "dark"),
  builtIn("c-catppuccin-mocha", "dark"),
  builtIn("d-synthwave", "dark"),
  builtIn("e-rose-pine-dawn", "light"),
  builtIn("f-gruvbox-dark", "dark"),
  builtIn("g-nord", "dark"),
  builtIn("h-dracula", "dark"),
  builtIn("i-everforest-dark", "dark"),
  builtIn("j-kanagawa", "dark"),
];

describe("resolveAutoTheme", () => {
  it("picks a-default when OS prefers dark and a-default is present", () => {
    expect(resolveAutoTheme(TEN_BUILT_INS, "dark")).toBe("a-default");
  });

  it("picks e-rose-pine-dawn when OS prefers light and it is present", () => {
    expect(resolveAutoTheme(TEN_BUILT_INS, "light")).toBe("e-rose-pine-dawn");
  });

  it("falls back to alphabetically-first dark theme when a-default is missing", () => {
    const without = TEN_BUILT_INS.filter((t) => t.id !== "a-default");
    expect(resolveAutoTheme(without, "dark")).toBe("b-tokyo-night");
  });

  it("falls back to alphabetically-first light theme when e-rose-pine-dawn is missing", () => {
    const customLights: ThemeEntry[] = [
      builtIn("a-default", "dark"),
      { id: "x-solarized-light", name: "Solarized Light", scheme: "light", builtIn: false },
      { id: "y-paper", name: "Paper", scheme: "light", builtIn: false },
    ];
    expect(resolveAutoTheme(customLights, "light")).toBe("x-solarized-light");
  });

  it("returns the literal a-default when no themes are loaded", () => {
    expect(resolveAutoTheme([], "dark")).toBe("a-default");
    expect(resolveAutoTheme([], "light")).toBe("a-default");
  });

  it("falls back to the first available theme when no theme matches the OS scheme", () => {
    const onlyDarkThemes: ThemeEntry[] = [
      builtIn("z-only-dark", "dark"),
    ];
    // OS prefers light, but no light theme exists — pick the first available.
    expect(resolveAutoTheme(onlyDarkThemes, "light")).toBe("z-only-dark");
  });

  it("custom themes can shadow built-ins by id without breaking auto resolution", () => {
    const userOverridesDefault: ThemeEntry[] = [
      ...TEN_BUILT_INS.filter((t) => t.id !== "a-default"),
      { id: "a-default", name: "User Default", scheme: "dark", builtIn: false },
    ];
    expect(resolveAutoTheme(userOverridesDefault, "dark")).toBe("a-default");
  });
});
