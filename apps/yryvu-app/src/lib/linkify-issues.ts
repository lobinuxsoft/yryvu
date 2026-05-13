// SPDX-License-Identifier: AGPL-3.0-or-later

/// Matches `#NN` issue refs, captured at word boundaries so trailing
/// punctuation (`,`, `.`, `)`) doesn't get absorbed into the ref. We
/// don't try to match Jira-style `ABC-123` keys yet — that's a follow-up
/// once user demands it; the pattern then becomes preference-driven.
const ISSUE_REF = /(?<![\w/])#(\d+)\b/g;

/// One piece of a linkified text stream — either a plain string or a
/// link describing the ref text + the resolved URL. Pure data so the
/// caller renders it however it wants (JSX in production, snapshot
/// inspection in tests). Keeps this module DOM-free.
export type LinkifiedSegment =
  | { kind: "text"; value: string }
  | { kind: "link"; text: string; href: string };

/// Split `text` into a stream of segments. Each `#NN` match becomes a
/// `"link"` segment when `enabled` is `true` and `pattern` is non-null;
/// otherwise the whole input collapses to a single `"text"` segment.
///
/// `pattern` is interpolated by replacing every literal `{id}` with the
/// captured digits. A pattern lacking `{id}` is tolerated — the digits
/// are appended at the end of the URL — so old GK-style patterns still
/// produce working links.
export function linkifyIssueRefs(
  text: string,
  pattern: string | null,
  enabled: boolean,
): LinkifiedSegment[] {
  if (!enabled || pattern === null || pattern.length === 0 || text.length === 0) {
    return [{ kind: "text", value: text }];
  }
  const segments: LinkifiedSegment[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(ISSUE_REF)) {
    const start = match.index;
    if (start === undefined) continue;
    if (start > lastIndex) {
      segments.push({ kind: "text", value: text.slice(lastIndex, start) });
    }
    const id = match[1];
    const href = pattern.includes("{id}")
      ? pattern.split("{id}").join(id)
      : `${pattern}${id}`;
    segments.push({ kind: "link", text: match[0], href });
    lastIndex = start + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ kind: "text", value: text.slice(lastIndex) });
  }
  if (segments.length === 0) {
    return [{ kind: "text", value: text }];
  }
  return segments;
}
