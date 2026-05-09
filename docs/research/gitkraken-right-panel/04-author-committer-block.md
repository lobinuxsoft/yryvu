# Author / committer / co-authors

The right panel shows a **three-level** identity block: author, committer
(when different), and co-authors (parsed from the message body). Each
has its own avatar, a labeled date row, and email hover tooltip.

## Structure

### Author block (always shown)

```jsx
<div className="flex items-start mb2">
  <div className="commit-info-wrapper">
    <div className="flex flex-column width-100-percent">
      <div className="commit-info">
        <div className="committer-image">           {/* misnomer — also used for author */}
          <Avatar authorInitials={initials(authorName)}
                  avatarUrlsByEmail={...}
                  email={authorEmail}
                  column={laneColor}
                  fontSize={12}
                  provider={provider}
                  size={40}/>
        </div>
        <div>
          <OverlayTrigger overlay={<Tooltip id="commit-detail-author-email-tooltip">{authorEmail}</Tooltip>}
                          placement="bottom">
            <span data-testid="commit-detail-section-author">
              {authorName}
            </span>
          </OverlayTrigger>
          <span>
            <span className="commit-info-label">{t("AuthoredLabel")}</span>
            <span data-test-class="commit-detail-section-date-authored">
              {formatDateTime(authorDate)}
            </span>
          </span>
        </div>
      </div>

      {/* parent-commits block below, doc 02 */}
    </div>
  </div>
</div>
```

### Committer block (only when different from author)

```jsx
{ (committerInfo
    && !(committerInfo.email === authorEmail
         && committerInfo.name === authorName)) && (
  <div className="commit-info committed-by mt2">
    <div className="committer-image">
      <Avatar authorInitials={initials(committerInfo.name)}
              email={committerInfo.email}
              size={40} fontSize={12}/>
    </div>
    <div>
      <OverlayTrigger overlay={<Tooltip>{committerInfo.email}</Tooltip>}
                      placement="bottom">
        <span data-testid="commit-detail-section-committer">
          {committerInfo.name}
        </span>
      </OverlayTrigger>
      <span>
        <span className="commit-info-label">{t("CommitterLabel")}</span>
        <span data-test-class="commit-detail-section-date-authored">
          {formatDateTime(committerInfo.date)}
        </span>
      </span>
    </div>
  </div>
)}
```

The whole committer block is suppressed when author === committer. This
is the common case (most commits have equal author/committer), so the
block typically doesn't render at all.

### Co-authors block

```jsx
{ coauthors.length > 0 && (
  <div className="flex mt2">
    <span className="fs-2 text-secondary">{t("CoauthorsLabel")}</span>
    {coauthors.map(c =>
      <Avatar authorInitials={initials(c.name)}
              avatarUrlsByEmail={...}
              classes={["ml1"]}
              column={laneColor}
              email={c.email}
              fontSize={12}
              provider={provider}
              size={20}                     // ← smaller
              tooltip={c.name || c.email}/>
    )}
  </div>
)}
```

Co-authors are **parsed from the commit message body** using:

```js
/^co-authored-by:\s*([^\s<>]+(?:\s+[^\s<>]+)*)\s*<([^<>]+)>/gim
```

i.e. lines in the body matching `Co-authored-by: Name <email>`. Case-
insensitive, multi-line, global. Extracted as `{name, email}` tuples.

Co-author avatars are **20 px** (vs 40 px for author/committer), with
just a hover tooltip for full name/email — no labeled date row. They
read as secondary.

## Avatar

The same `<Avatar>` component used on the graph row:

```jsx
<Avatar
  authorInitials={initials(name)}      // fallback
  avatarUrlsByEmail={cachedByEmail}     // user-provided or provider CDN
  column={laneColor}                    // inherits the commit's lane color
  email={email}
  fontSize={12}
  provider={hostingServiceProvider}     // for provider-specific avatar CDN
  size={40 | 30 | 20}
/>
```

Sizes used in the right panel:
- **40 px** — author, committer (main identity rows).
- **30 px** — inline `mini-commit-info` (multi-commit cards).
- **20 px** — co-author row.

`fontSize: 12` throughout, so when the avatar falls back to initials,
they stay legible at every size.

### Initials algorithm

```js
getInitialsFromName = memoized((name) => {
  let initials = "?";
  const trimmed = (name || "").trim();
  if (trimmed.length === 0) return initials;
  const parts = trimmed.split(" ");
  if (parts.length === 1) initials = parts[0][0];
  if (parts.length > 1)   initials = parts[0][0] + parts[parts.length-1][0];
  return initials.toUpperCase();
});
```

- Empty / whitespace → `"?"`.
- Single-word name → first letter.
- Multi-word → first + last letters.
- Always upper-cased.
- Memoized (same function reference reused).

Examples:
- `"lobinux"` → `L`.
- `"Jane Doe"` → `JD`.
- `"Jane Ann Doe"` → `JD` (first + last, middle ignored).
- `""` → `?`.

## Labels

From `en-us.json`:

| Key | Value |
|-----|-------|
| `AuthoredLabel`  | `"authored"`  |
| `CommitterLabel` | `"committed"` |
| `CoauthorsLabel` | `"Co-authors:"` |
| `Author`         | `"Author"`    |
| `ParentLabel`    | `"parent:"`   |
| `ParentLabelBadge` | `"PARENT:"`  (shouty variant, used in badge contexts) |
| `CommitLabel`    | `"commit:"`   |
| `CommitLabelBadge` | `"COMMIT:"`  |

Rendered as small (`commit-info-label` class) preceding the date:

```
[Jane Doe]
authored 2024-03-15 @ 14:32

[Jane Doe]
committed 2024-03-15 @ 14:32
```

## Email display

Email is **not rendered in the flow** — only shown as a hover tooltip
(`OverlayTrigger` with `placement="bottom"` and `id="commit-detail-author-email-tooltip"`)
when hovering the author/committer name.

This means yryvu's layout doesn't need to handle long-email overflow —
emails are out of the main flow entirely.

## Timestamp format

Both `authored` and `committed` rows use `formatDateTime(Ve)` with the
**default format** (`DATE_TIME`):

```js
formatDateTime(ts, DATE_TIME)   // default
// locale-aware via moment: "3/15/2024 @ 2:32 PM"  (en-US)
//                          "15/03/2024 @ 14:32"  (es)
```

Derived from moment's locale long-date format:

```js
`${localeData.longDateFormat("L")} @ ${localeData.longDateFormat("LT")}`
```

So the display pattern is `{localeDate} @ {localeTime}`. No relative
format ("2 hours ago") in the main author/committer rows — that's only
used in the `mini-commit-info` card and on graph rows.

## "Committed by X on behalf of Y"

GK doesn't phrase it that way — it just renders the two blocks
separately (author above, committer below in its own block), with clear
labels. If the email/name are identical, only author renders. That's
more transparent than a combined sentence.

## Yryvu implications

1. **Two separate blocks** (author / committer), not a merged
   sentence. Render committer block only when `authorEmail/Name !==
   committerEmail/Name`.
2. **Co-authors block** at the bottom, smaller avatars (20 px), parsed
   from the message body via the documented regex. No labeled date per
   co-author — just hover tooltip.
3. **Avatar sizes**: 40 (primary), 30 (inline cards), 20 (co-authors),
   always `fontSize: 12`.
4. **Initials**: first+last, upper-case, `"?"` for empty. Port the
   exact algo — tests should match GK exactly.
5. **Email** is tooltip-only, not in the flow. No overflow handling
   needed in the layout.
6. **Timestamp** in author/committer rows: locale-aware "L @ LT" (e.g.
   "3/15/2024 @ 2:32 PM"). Not relative. Yryvu should use `time` crate
   with user's locale or default to ISO-like `YYYY-MM-DD HH:mm`.
7. **Labels**: `authored` / `committed` / `Co-authors:` — lowercase,
   terse, no colon on first two. Match EN strings verbatim.

## Source

Bundle: same.

- `"commit-info"` / `"commit-info committed-by mt2"` / `"committer-image"` —
  block classes.
- `"commit-info-label"` — small-caps label span.
- `"commit-info-author-section"` — author section test class (data-testid).
- `"commit-detail-section-author"` / `"-committer"` / `"-date-authored"` —
  `data-testid` / `data-test-class` hooks.
- `"commit-detail-author-email-tooltip"` — tooltip id for email hover.
- `getInitialsFromName=(0,hn.default)((Ve=>{…first+last upper…}))` —
  initials algo.
- `getCommitMessageCoauthors=Ve=>(…, mn=/^co-authored-by:\s*…<email>/gim)` —
  coauthor extractor.
- `"AuthoredLabel":"authored"` / `"CommitterLabel":"committed"` /
  `"CoauthorsLabel":"Co-authors:"` — en-US strings.
- Avatar sizes `size:40` (author, committer), `size:30` (mini), `size:20`
  (coauthor).
