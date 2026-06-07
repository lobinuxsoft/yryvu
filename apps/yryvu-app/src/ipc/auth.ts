// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/**
 * Snapshot of the host credential environment, mirrors the backend
 * `AuthEnv` (`crates/yryvu-bridge/src/repo/remote/auth_env.rs`). Drives
 * the credential setup wizard (#44).
 */
export interface AuthEnv {
  /** `SSH_AUTH_SOCK` is set — an ssh-agent is reachable. */
  sshAgentSocket: boolean;
  /** Identities `ssh-add -l` reports loaded. Zero = empty/unreachable. */
  sshKeysLoaded: number;
  /** Global `credential.helper` value, when configured. */
  credentialHelper: string | null;
  /** Host OS (`linux` | `macos` | `windows` | …). */
  hostOs: string;
}

export function detectAuthEnv(): Promise<AuthEnv> {
  return invoke<AuthEnv>("detect_auth_env");
}

/** True when at least one credential method can satisfy a push. A
 * reachable-but-empty ssh-agent does not count. Mirrors
 * `AuthEnv::has_usable` so the frontend can branch without a round-trip. */
export function hasUsableCredentials(env: AuthEnv): boolean {
  return env.sshKeysLoaded > 0 || env.credentialHelper !== null;
}
