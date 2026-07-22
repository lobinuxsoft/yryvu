// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FileStatus } from "../../ipc";

/// The four buckets every status collapses into. Same set GitKraken
/// counts on collapsed directory rows (`DiffStats`, bundle 3698457):
/// `modified`, `added`, `deleted`, `renamed`. Narrower than `FileStatus`
/// on purpose — `copied` reads as a rename, `type-change` as a
/// modification, and the two non-states fall through to `modified`.
export type StatusTone = "added" | "modified" | "deleted" | "renamed";

export function statusTone(
  status: FileStatus,
): { label: string; tone: StatusTone } {
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
