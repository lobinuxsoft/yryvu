// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/** Mirrors `ssh_keygen::GenerateSshKeyRequest`. */
export interface GenerateSshKeyRequest {
  /** "ed25519" (default, instant) or "rsa4096" (seconds — spinner). */
  algorithm: "ed25519" | "rsa4096";
  /** Key comment, conventionally user@host or an email. */
  comment: string;
  /** Empty string = unencrypted private key. */
  passphrase: string;
  /** File stem under ~/.ssh, e.g. "yryvu_github". */
  fileName: string;
}

/** Mirrors `ssh_keygen::GeneratedSshKey`. */
export interface GeneratedSshKey {
  /** OpenSSH one-liner ready to paste into the provider settings. */
  publicKey: string;
  privateKeyPath: string;
  /** SHA256:… fingerprint. */
  fingerprint: string;
}

/** Mirrors `ssh_keygen::SshTestResult`. */
export interface SshTestResult {
  authenticated: boolean;
  /** Provider banner or ssh's own error text. */
  message: string;
}

/// Generate an SSH keypair under ~/.ssh (private key written 0600).
export function generateSshKey(
  req: GenerateSshKeyRequest,
): Promise<GeneratedSshKey> {
  return invoke<GeneratedSshKey>("generate_ssh_key", { req });
}

/// Verify SSH auth against `git@{host}` via the real `ssh -T` binary.
/// Provider-agnostic: exit 255 = failed, anything else = authenticated.
export function testSshConnection(host: string): Promise<SshTestResult> {
  return invoke<SshTestResult>("test_ssh_connection", { host });
}

/// Load a private key into the running ssh-agent (non-interactive —
/// passphrase-protected keys reject with ssh-add's error).
export function addSshKeyToAgent(privateKeyPath: string): Promise<void> {
  return invoke<void>("add_ssh_key_to_agent", { privateKeyPath });
}
