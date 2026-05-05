// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Vitest config — separate from vite.config.ts so the test environment
 * doesn't drag the Tauri dev-server settings (fixed port, HMR config,
 * src-tauri watch ignore) into the test process.
 *
 * `environment: "node"` skips the jsdom dependency. Tab system tests
 * exercise Solid signals + the Promise queue dispatcher with no DOM
 * surface — node is the right pick. When a future test needs DOM (e.g.
 * a component render test), switch that file to a per-file `// @vitest-
 * environment jsdom` directive AND add jsdom to devDependencies; don't
 * flip the global default.
 */

import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["./src/test-setup.ts"],
  },
});
