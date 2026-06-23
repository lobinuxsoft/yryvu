// SPDX-License-Identifier: AGPL-3.0-or-later

import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [solid()],

  // Pre-bundle the Markdown ESM chain (#60). WebKit rejects raw `export *`
  // re-exports with "Importing binding name 'default' cannot be resolved
  // by star export entries"; esbuild's optimize pass rewrites them with
  // proper default interop so the dev webview can load them. The
  // production rollup build already handles this, so it only bites in
  // `tauri dev`.
  //
  // `solid-markdown` itself is NOT optimizable (esbuild can't compile its
  // Solid `.jsx` entry — vite-plugin-solid handles that), so we instead
  // pre-bundle the unified/remark/rehype packages it pulls in raw, plus
  // the plugins we use directly. esbuild bundles their transitives
  // (micromark, mdast-util-*, …) along with them.
  optimizeDeps: {
    include: [
      "remark-gfm",
      "remark-breaks",
      "rehype-sanitize",
      "unified",
      "remark-parse",
      "remark-rehype",
      "vfile",
      "unist-util-visit",
      "property-information",
      "comma-separated-tokens",
      "space-separated-tokens",
    ],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
