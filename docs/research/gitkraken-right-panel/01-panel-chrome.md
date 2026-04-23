# Panel chrome, visibility, resize

GitKraken's right panel is actually the **bottom-right panel** (it sits along
the right edge, anchored to the bottom of the main area). GitKraken routes
every "right panel" configuration through a single `RightPanelType` enum:

```js
RightPanelType = {
  COMMIT_DETAILS:   ... ,
  EXPLAIN_COMMITS:  ...,   // AI — out of scope for chajá
  EXPLAIN_WIP:      ...,   // AI — out of scope
  EXPLAIN_BRANCH:   ...,   // AI — out of scope
}
```

The commit inspector is the `COMMIT_DETAILS` case. The explain panels reuse
the same outer shell but mount a different inner component — chajá only
cares about the commit one.

## Top-level component tree

Observed React tree when `currentVisiblePanelType === COMMIT_DETAILS`:

```
<Resizable className="detail-panel"                 // outer shell w/ resize
           resizeEdge="left"
           handleStyles={{ left: {left: 0} }}        // handle on left edge
           heightConstraints={{ min: 566, max: <calc> }}
           widthConstraints={{ min: 353, max: <calc> }}>
  <CommitDetailsContainer>
    <div class="commit-detail-wrapper collapsed"
         data-testid="commit-detail-container">
      <div class="commit-detail-panel">
        <HeaderBlock1 />  // commit header row (sha + parents)
        <HeaderBlock2 />  // message block
        <HeaderBlock3 />  // author/committer/coauthors
        <AutoSizer>
          { hasSelectedCommits
              ? <CommitDiffSection panelHeight={h} />
              : <WipCommitPanel forcePosition={x} /> }
        </AutoSizer>
      </div>
    </div>
  </CommitDetailsContainer>
</Resizable>
```

The three "header block" `createElement` calls at the top of
`commit-detail-panel` are fixed static children (commit info / message /
author) — they render before the AutoSizer, so they're above the
scrollable file list.

## Tab switcher (absent on the inspector)

There **is no tab switcher** between "Commit Details" and "AI Explain" in
the panel itself. The `EXPLAIN_*` panels replace the entire inner
component — `currentVisiblePanelType` is a single value, not a tab index.
Switching is done by actions like `RightPanelRequestCleared` /
`setCurrentVisiblePanelType`.

The `CommitDetailPanel-Tab-*` strings (`Commit`, `Stash`, `CloudPatch`,
`CodeSuggest`) in `en-us.json` belong to a **different** tab strip — the
one above the **commit message input** on the staging/commit side, NOT
the inspector side. The staging tab state is `detailPanelTabIds`
(`commit | stash | cloudPatch | codeSuggest`). Don't conflate.

Chajá's inspector is a single-panel design, same as GitKraken.

## Visibility gating

Selectors (from module that exports `getCanRightPanelBeShown`):

| Selector | Purpose |
|----------|---------|
| `getIsRightPanelVisible`      | Final boolean — should the panel render at all? Derived from `getIsRightPanelLocked`, `getIsRightPanelPreferredShown`, `isInSomeState`, `getSelectedShas.length`. |
| `getIsRightPanelLocked`       | `createSelector(...)` — true when some state forces it open (resolving conflicts, creating patch, AI explain, reviewing PR, etc). |
| `getIsRightPanelLockedVisible` | Re-exports `getIsRightPanelLockedVisibleFromState`. |
| `getIsRightPanelLockedHiddenFromState` | Force-hidden by a state. |
| `getIsRightPanelPreferredShown` | User preference from the profile setting tree — `getCurrentProfileSetting(Ve, ["layout","DetailPanel","open"])`. |
| `getCanRightPanelBeShown`     | `createSelector(getIsRepoOpen, getIsResolvingFile, getLeftPanelIssueSectionSelectedIssue, getLeftPanelPullRequestSectionSelectedPullRequest, ...)` — blocks panel when a left-panel issue/PR is fullscreen, etc. |
| `getCanRightPanelBeToggled`   | True if the toggle keybind can flip visibility right now. |
| `getRequestedRightPanel`      | A one-shot request to switch panel type (cleared by `RightPanelRequestCleared`). |

Combined rule (inferred from code):

```
visible = isRightPanelLocked
       || (canBeShown && isPreferredShown && hasSelectedShas.length > 0)
```

That is: hard-locked wins, otherwise render only when both the preference
is on AND at least one commit is selected (or WIP row counts — see
`getSelectedCommitsYoungestToOldestIncludingWorkdir`).

## Persistence

Panel size and open/closed live in the **profile settings** tree, not
the ephemeral redux `ui.layout`:

```js
layout.DetailPanel = { height: 386, open: true, width: 400 }   // defaults
```

Stored via `setCurrentProfileSetting(["layout","DetailPanel","width"], W)`
on resize-end. Profile-level, so it survives repo switches and app
restarts.

Additionally, there's a second piece of layout state:

```js
layout.CommitMessage = {
  rightPanelHeight: initialCommitMessageHeight,         // 150
  pendingRightPanelHeight: initialCommitMessageHeight,  // 150
}
```

This second slice is the height of the **commit message editor on the
staging side**, not the inspector's height. The name `rightPanelHeight`
is misleading — it's really "commit message textarea pending height."
Don't reuse that path for the inspector in chajá; use a distinct
`DetailPanel.height` setting.

## Resize

- **Edge**: left only (`resizeEdge: "left"`). The panel resizes horizontally
  by dragging its left border and vertically by dragging the top.
- **Handle position**: `handleStyles = { left: { left: 0 } }` — the handle
  sits flush on the panel's left edge (0 offset).
- **Width constraints**: `min: 353, max: window.innerWidth - 651 [or 687 when
  CLI pane collapsed]`. The `651` is an empirical offset for "everything
  left of the panel" (title bar + toolbar + graph + left panel).
- **Height constraints**: `min: BOTTOM_DETAIL_PANEL_MIN_HEIGHT = 566`,
  `max: ((outerHeight or height) - Xr) / Ia` — derived from window size
  and `--title-bar-height`, `--toolbar-height`, `--tabs-bar-height`,
  `--info-bar-height` CSS variables. The max-height formula:
  ```
  "calc(100vh - var(--title-bar-height)
              - var(--toolbar-height)
              - var(--tabs-bar-height)
              - var(--info-bar-height)
              - 36px)"
  ```
- **On resize end**: `setCurrentProfileSetting(["layout","DetailPanel","width"], w)`
  — width is persisted per-profile. Height isn't persisted via this
  callback in the grep I found (may persist elsewhere).
- **Clamping**: `height: clamp(566, currentHeight, maxHeight)` — actively
  clamps on every render, so if the viewport shrinks below the stored
  height, the panel shrinks instead of overflowing.

## Collapse state

The outermost `<div>` always carries `className="commit-detail-wrapper collapsed"`.
The literal word `collapsed` is hard-coded — not conditional on a state.
This means the "collapsed" is a CSS modifier that styles the panel's
internal padding/spacing, not an expanded/collapsed toggle. Expanded
visibility is gated outside this div via the `ua&&` short-circuit around
the `<Resizable>`, not a class toggle.

## Keyboard shortcut

- `Ctrl+K` (Win/Linux) / `Cmd+K` (mac) — toggles the panel open/closed.
- Bound command: `RightPanel.toggleDetailPanel`.
- Label: `View-ToggleDetailPanel` = "Toggle Commit Details Panel".
- Saga: `toggleDetailPanelSaga` flips `layout.DetailPanel.open` in the
  profile settings.

## Chajá implications

1. Single-panel design, no tab switcher on the inspector. The "tabs"
   strings in the bundle are for the staging side.
2. Persist width/height in a profile-scoped setting keyed off repo
   identity, not redux UI state — match `layout.DetailPanel.{width,
   height, open}` semantics so the user's choice survives repo switches.
3. Min dimensions: width 353, height 566. These are GK's numbers; chajá
   can keep them verbatim for 1:1 feel or tighten them to save real
   estate on smaller windows.
4. Bind a toggle shortcut (`Cmd/Ctrl+K`) to open/close the panel.
5. Resize handle lives on the left edge only — keep the top edge static
   (the top is clipped by the toolbar).
6. Panel visibility = `(isLocked) || (userPrefersOpen && canShow && hasSelection)`.
   The "no selection" state should hide the panel rather than showing
   an empty placeholder — see doc 09.

## Source

Bundle: `/var/mnt/DATA/gitkraken-extract/app/src/render/static/entryPoints/main/render.bundle.js`

Grep patterns:
- `"commit-detail-wrapper collapsed"` — outer DOM shell.
- `"commit-detail-panel"` — inner container.
- `resizeEdge:"left"` — resize config.
- `handleStyles:ta,` then `ta={left:{left:0}}` — resize handle spec.
- `BOTTOM_DETAIL_PANEL_MIN_HEIGHT=566` — height floor constant.
- `"layout","DetailPanel","width"` / `"open"` — profile setting path.
- `RightPanelType.COMMIT_DETAILS` — enum value.
- `RightPanel.toggleDetailPanel` — keybind command id.
- `View-ToggleDetailPanel` — label string.
- `getIsRightPanelVisible=(0,dn.createSelector)(gr,mn.getIsRightPanelPreferredShown,kr,Dn.getSelectedShas,((Ve,at,ct,dt)=>Ve||ct&&at&&dt.length>0))` — the composite visibility rule.
