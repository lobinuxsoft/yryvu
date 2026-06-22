// SPDX-License-Identifier: AGPL-3.0-or-later

/// Adapted from GitKraken's `MarkdownLink-FileOutsideRepository`. Shown
/// when a preview link targets a local file instead of an http(s) URL.
export const LINK_BLOCKED_MESSAGE =
  "Yryvu blocked opening this link because it tried to access a file on your machine outside of the repository.";

export type LinkAction = "anchor" | "external" | "blocked";

/// Classify a preview link href. `anchor` (in-document `#…` or empty) is
/// left to the default scroll; `external` (http/https/mailto) opens in
/// the system browser; everything else (local files, relative paths) is
/// `blocked` with the out-of-repository warning. rehype-sanitize already
/// strips `file:` / `javascript:` hrefs, so this is the second line of
/// defence and keeps relative links from escaping the repo.
export function classifyLink(href: string): LinkAction {
  if (href === "" || href.startsWith("#")) return "anchor";
  if (/^https?:\/\//i.test(href) || href.startsWith("mailto:")) return "external";
  return "blocked";
}
