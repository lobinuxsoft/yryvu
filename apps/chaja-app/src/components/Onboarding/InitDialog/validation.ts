// SPDX-License-Identifier: AGPL-3.0-or-later

const BRANCH_NAME_RE = /^[A-Za-z0-9._/-]+$/;

export type FieldError =
  | { kind: "ok" }
  | { kind: "empty" }
  | { kind: "branch-shape" }
  | { kind: "folder-slash" };

export function checkParentPath(value: string): FieldError {
  return value.trim().length === 0 ? { kind: "empty" } : { kind: "ok" };
}

export function checkFolderName(value: string): FieldError {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { kind: "empty" };
  if (trimmed.includes("/")) return { kind: "folder-slash" };
  return { kind: "ok" };
}

export function checkBranchName(value: string): FieldError {
  const trimmed = value.trim();
  if (trimmed.length === 0) return { kind: "empty" };
  if (!BRANCH_NAME_RE.test(trimmed)) return { kind: "branch-shape" };
  return { kind: "ok" };
}

export function fieldErrorMessage(err: FieldError): string | null {
  switch (err.kind) {
    case "ok":
      return null;
    case "empty":
      return "Required.";
    case "branch-shape":
      return "Use letters, digits, dot, dash, underscore, or slash.";
    case "folder-slash":
      return "Folder names cannot contain '/'.";
  }
}
