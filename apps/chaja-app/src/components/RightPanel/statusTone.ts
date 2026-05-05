// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FileStatus } from "../../ipc";

export function statusTone(status: FileStatus): { label: string; tone: string } {
  switch (status) {
    case "added":
      return { label: "A", tone: "added" };
    case "modified":
      return { label: "M", tone: "modified" };
    case "deleted":
      return { label: "D", tone: "deleted" };
    case "renamed":
      return { label: "R", tone: "renamed" };
    case "copied":
      return { label: "C", tone: "renamed" };
    case "type-change":
      return { label: "T", tone: "modified" };
    default:
      return { label: "·", tone: "modified" };
  }
}
