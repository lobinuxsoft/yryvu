// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Vitest setup. The test environment is `node` (see vitest.config.ts) so
 * there's no DOM, no `localStorage`, no `crypto.randomUUID`. The legacy
 * state.ts module reads `localStorage` at import time for theme + panel
 * persistence — without a stub, any test file that pulls in code which
 * transitively imports `state.ts` crashes on import. Stub a minimal
 * `Storage`-shaped object.
 *
 * `crypto.randomUUID` is provided by Node 16+ but only exposed under the
 * Web Crypto API on globalThis.crypto in 19+. Polyfill it for older
 * Node versions just in case (vitest can run anywhere CI puts it).
 */

class MemoryStorage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

if (typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    value: new MemoryStorage(),
    writable: false,
  });
}

if (typeof globalThis.crypto === "undefined") {
  // @ts-expect-error — node-only fallback
  globalThis.crypto = require("node:crypto").webcrypto;
}
