// SPDX-License-Identifier: AGPL-3.0-or-later

const SCP_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:.+$/;

export type Protocol = "https" | "http" | "ssh" | "git" | "local" | "unknown";

export function detectProtocol(url: string): Protocol {
  const trimmed = url.trim();
  if (trimmed.length === 0) return "unknown";
  if (trimmed.startsWith("https://")) return "https";
  if (trimmed.startsWith("http://")) return "http";
  if (trimmed.startsWith("ssh://")) return "ssh";
  if (trimmed.startsWith("git://")) return "git";
  if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) {
    return "local";
  }
  if (SCP_RE.test(trimmed)) return "ssh";
  return "unknown";
}

export function isPlausibleUrl(url: string): boolean {
  return detectProtocol(url) !== "unknown";
}

/// Extract the trailing repo segment from a clone URL, stripping `.git`.
/// `https://github.com/foo/bar.git` -> `bar`. Empty input or unparseable
/// URLs return an empty string so the caller can leave the folder name
/// untouched.
export function deriveFolderName(url: string): string {
  const trimmed = url.trim();
  if (trimmed.length === 0) return "";

  // SCP form `user@host:path` — take everything after the first `:`.
  let candidate = trimmed;
  if (SCP_RE.test(trimmed)) {
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx >= 0) candidate = trimmed.slice(colonIdx + 1);
  }

  // Strip query strings and trailing slashes, keep the last path segment.
  candidate = candidate.split("?")[0].split("#")[0].replace(/\/+$/, "");
  const lastSlash = candidate.lastIndexOf("/");
  if (lastSlash >= 0) candidate = candidate.slice(lastSlash + 1);

  if (candidate.endsWith(".git")) candidate = candidate.slice(0, -4);
  return candidate;
}

export type FieldError =
  | { kind: "ok" }
  | { kind: "empty" }
  | { kind: "invalid-url" }
  | { kind: "folder-slash" };

export function checkUrl(value: string): FieldError {
  if (value.trim().length === 0) return { kind: "empty" };
  if (!isPlausibleUrl(value)) return { kind: "invalid-url" };
  return { kind: "ok" };
}

export function checkParentPath(value: string): FieldError {
  return value.trim().length === 0 ? { kind: "empty" } : { kind: "ok" };
}

export function checkFolderName(value: string): FieldError {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { kind: "empty" };
  if (trimmed.includes("/")) return { kind: "folder-slash" };
  return { kind: "ok" };
}

export function fieldErrorMessage(err: FieldError): string | null {
  switch (err.kind) {
    case "ok":
      return null;
    case "empty":
      return "Required.";
    case "invalid-url":
      return "Use https://, ssh://, git://, user@host:path, or a local path.";
    case "folder-slash":
      return "Folder names cannot contain '/'.";
  }
}
