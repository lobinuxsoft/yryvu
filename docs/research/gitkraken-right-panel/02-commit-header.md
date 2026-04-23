# Commit header — SHA, parents, no ref pills

The top block of the right panel contains the commit's identity: short
SHA link (clickable → copies), parent SHA(s), date. There is **no** ref
pill strip (branches/tags attached to this commit) inside the inspector
— those pills live on the graph row itself, not duplicated here.

## Structure (from `mini-commit-info` / `commit-info` blocks)

The panel has two header styles — which one appears depends on selection:

### Single commit (`commit-info-and-message`)

```html
<div class="commit-info-and-message">
  <!-- rendered via helper that produces a {sha + parent + author + message} bundle -->
</div>
```

### Each inline commit card (multi-select) — `mini-commit-info`

```html
<div class="mini-commit-info">
  <div class="col-left">
    <Avatar authorInitials email size={30} fontSize={12} column={lane}/>
  </div>
  <div class="col-middle">
    <div class="message" title="{fullMessage}">
      {getCommitMessageSummary(message)}   <!-- subject only -->
    </div>
    {sha !== workDirType && (
      <div class="signature" data-testid="mini-commit-info-author-section">
        <span class="date" title="{dateTooltip}">
          {translate("CommitDiffSection-DateByAuthorName", formattedDate, authorName)}
          {/* "{date} by {name}" — "2 hours ago by lobinux" */}
        </span>
      </div>
    )}
  </div>
  <div class="col-right">
    <div class={shaClasses} onClick={onShaClick} title={shaTooltip}>
      {isShaCopyable ? <CopyToClipboard value={sha}><a class="btn-link">{shortSha}</a></CopyToClipboard>
                     : shortSha}
    </div>
  </div>
</div>
```

The three-column `col-left / col-middle / col-right` layout is fixed:
avatar | message+date | SHA pill.

## Short SHA

```js
getShortSha = sha => sha && sha !== workDirType ? sha.substring(0, 6) : sha
```

**6 characters**, not 7 (git CLI default) or 8 (GitHub default). If
chajá wants to match, truncate to 6. The WIP pseudo-sha returns the
`workDirType` sentinel unchanged so the "copy SHA" button is suppressed.

## Copy SHA flow

Uses a reusable `CopyToClipboard` component. Observed handler body:

```js
_onCopyToClipboardClick = () => {
  clipboard.writeText(sha);                              // electron API
  overlayTrigger.hide();
  this.setState({ textCopiedToClipboard: true });
  if (overlayWasShown) overlayTrigger.show();            // re-show tooltip
}
_onCopyToClipboardBlur = () => { setState({textCopiedToClipboard: false}) }
```

Tooltip text flips between:

- `TextOperation-Copy` = `"Copy"` (idle)
- `TextOperation-CopySuccess` = `"Copied!"` (after click, until blur)

The `OverlayTrigger` wraps the `<a class="btn-link">` — hovering the
short-SHA link shows the Copy tooltip, clicking writes to clipboard and
shows "Copied!". On blur the state resets.

**No flash timeout** — the visual "Copied!" stays until the user moves
focus away. Simpler than most UIs that auto-hide after 2s.

## Parent SHAs

Rendered in a **separate** block below the author section, not inline
with the short SHA:

```html
<div class="parent-commits">
  <span>
    <span class="commit-info-label">{translate("ParentLabel")}</span>
    <!-- e.g. "parent:" -->
    <span data-test-class="commit-detail-section-parent">
      <ParentCommit sha={p1}/><span class="comma">,</span>
      <ParentCommit sha={p2}/>
      <!-- commas only between items -->
    </span>
  </span>
</div>
```

Each `<ParentCommit>` is:

```jsx
<ParentCommit
  isParentCommitInGraph={boolean}
  onNavigateToParentCommit={sha => jumpToSha(sha)}
  onPopupCommitParentMenu={...}
  sha={sha}
  translate={t}
>
  <OverlayTrigger
     trigger={["hover","focus"]}
     delayShow={10}
     onClick={() => navigate(sha)}
     overlay={<Tooltip id="navigate-to-parent-tooltip">
                {t(isInGraph ? "ContextMenu-GoToParentCommit"
                             : "ContextMenu-CommitNotInGraph")}
              </Tooltip>}
     placement="bottom">
    <span>{shortSha}</span>
  </OverlayTrigger>
</ParentCommit>
```

Tooltip variants:
- `ContextMenu-GoToParentCommit` = `"Jump to commit in graph"` (in-graph)
- `ContextMenu-CommitNotInGraph` = `"Can't jump to commit in graph, because it's not visible."` (out of filter)

Click action: navigate the graph to the parent. No-op-with-tooltip if
the parent isn't currently displayed on the graph (e.g. date-filtered out).

The parent menu popup (right-click) offers the same `ContextMenu-Copy*`
actions you'd get on a graph row.

### Merge commits

Multiple parents list comma-separated. `flow(toPairs, map)` iterates the
parent record — so the order is `{ 0: firstParent, 1: secondParent }`
(numeric keys). For an octopus merge this produces `parent1, parent2, parent3`.

## No badges for merge / revert / cherry-pick

**Searched aggressively** for commit-type badges — none found. The
commit type is not visualized in the inspector as a colored badge.
Cherry-pick and revert are handled via:

- Message detection only (message starts with `Revert` / `cherry-pick`).
- Context menu actions `ContextMenu-RevertCommit`, `ContextMenu-CherrypickCommit` exist as operations, but no inverse indicator.

Merge commits are implicit via having 2+ parents (the comma-separated
parent row is the only visual cue).

Chajá can add badges if it wants (matches GitHub/Jira conventions), but
this would be a **deviation** from 1:1 GK parity. Flag this as a choice.

## Ref pills attached to commit

**None in the inspector.** GitKraken shows branch/tag ref pills only
on the graph row itself (covered in `gitkraken-graph/06-ref-pills.md`),
not duplicated in the right panel. If a commit has 5 branches pointing
at it, you see 5 pills on the row; none in the inspector.

If chajá wants to show ref pills in the inspector header (a reasonable
UX upgrade), it's a deviation — worth doing behind an opt-in flag at
first.

## Timestamp format (on SHA row)

The `mini-commit-info` shows the date as:

```
{relativeDate} by {authorName}     // "2 hours ago by lobinux"
```

via `CommitDiffSection-DateByAuthorName` = `"{0} by {1}"`, where `{0}` is
formatted via `formatDateTime(ts, DATE_RELATIVE)` → moment's `fromNow()`.
A full-absolute date is on the `title` attribute (tooltip).

## Chajá implications

1. **Short-SHA**: 6 chars (`sha[0..6]`). Not 7.
2. **Copy-SHA**: reusable `CopyToClipboard` wrapper around the SHA
   anchor. Tooltip flips `"Copy"` → `"Copied!"` on click, resets on blur.
   No auto-timeout.
3. **Parents row**: below author, prefixed with lowercase `"parent:"`
   label. Comma-separated. Each SHA is a short-SHA pill, clickable to
   jump to parent. Hovering shows "Jump to commit in graph" or "Can't
   jump…" depending on whether the parent is visible in current graph.
4. **No ref pills** in inspector. Match GK or opt-in to show.
5. **No commit-type badges** (merge/revert/cherry-pick) — none in GK.
   Optional extension.
6. **Relative date** via moment `fromNow()` is the primary display;
   absolute datetime is the `title` attribute.

## Source

Bundle: same.

- `getShortSha=Ve=>Ve&&Ve!==gn.workDirType?Ve.substring(0,6)` — short
  SHA algorithm.
- `"mini-commit-info"` — the single-commit card container class.
- `"col-left"` / `"col-middle"` / `"col-right"` — three-column layout.
- `"parent-commits"` / `"commit-detail-section-parent"` / `"comma"` —
  parent row structure.
- `isParentCommitInGraph` / `onNavigateToParentCommit` / `onPopupCommitParentMenu` —
  parent pill props.
- `"ContextMenu-GoToParentCommit"` / `"ContextMenu-CommitNotInGraph"` —
  parent tooltip variants.
- `"CommitDiffSection-DateByAuthorName":"{0} by {1}"` — date signature.
- `"TextOperation-Copy"` / `"TextOperation-CopySuccess"` — copy tooltip
  states.
- `clipboard.writeText` — electron API for clipboard write.
