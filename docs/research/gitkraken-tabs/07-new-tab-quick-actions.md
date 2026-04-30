# NEW Tab — Quick Actions

The NEW tab type fills the main viewport with a "What's next?" landing screen: title, three quick actions (Clone / Open / Init), and a recent-repos grid. It's what the user sees after `Cmd+T`, after `+`-button click, after `replaceSelectedTabWithNewTab`, and at first run when no repos are open.

This depends on **#100** (open / clone / init repo dialogs). The NEW tab is the wrapper; #100 ships the modal contents that the action buttons launch.

## Title + tooltip (bundle:142780, 330192, 330407, 375632)

The string `TabsBar-NewTabTitle` (resolved via i18n) appears in:

- The tab pill itself when tab is empty (`bundle:330192`).
- The new-tab tooltip on the `+` button hover (`bundle:142780-142782`):
  ```js
  // tooltip body
  span("TabsBar-NewTabTitle"),                                            // "New Tab"
  span("TabsBar-NewTabDescription", keyboard.commandKey[process.platform]) // "Open a new tab (Cmd+T)"
  ```
- The empty NEW tab body (`bundle:330407-330409`):
  ```js
  span("TabsBar-NewTabTitle"),
  span("(", "TabsBar-NewTabDescription", keyboard.commandKey[platform], ")")
  ```

**Note:** the literal "What's next?" cited in #135's body is the chajá copy; GK's i18n key resolves to "New Tab" in English. Use whichever copy aligns with the brand voice — the body says "What's next?" and the tooltip says "(Ctrl+T)".

## Recent repos limit (bundle:182648)

```js
at.RECENTLY_OPENED_LIMIT = 8;
at.RECENTLY_OPENED_BREADCRUMBS_LIMIT = 4;
```

**Port verbatim**:
- `RECENTLY_OPENED_LIMIT = 8` — the grid shows up to 8 recent repos.
- `RECENTLY_OPENED_BREADCRUMBS_LIMIT = 4` — secondary "breadcrumbs" surface (used elsewhere in the repo selector, not in the NEW tab).

## Recent-repos source (bundle:352626-352660)

Two selectors matter:

| Selector | Returns |
|---|---|
| `getRecentLocalRepos` | top 8 repos from `localRepoCache`, current parent path inserted first |
| `getRecentLocalReposWithoutCurrentlyOpenRepo` | same, but excludes the currently-open repo |

For the NEW tab, use **`getRecentLocalReposWithoutCurrentlyOpenRepo`** — opening a repo you already have open in another tab is the wrong action; the dropdown's `switchToRepoTabIfItExists` would fire instead.

Each entry in the grid is `{path, name, lastOpenedAt}`. Click → `openRepoInSelectedTab(path)` (replaces NEW tab with REPO).

## Quick actions

The three buttons across the top of the body:

| Button | Action | Modal | Issue |
|---|---|---|---|
| **Clone repo** | open Clone modal | clone-repo URL + path picker | #100 |
| **Open repo** | open OS file picker for a directory | uses Tauri `dialog::open` | #100 |
| **Init repo** | open Init modal | path picker + initial-branch input | #100 |

In the chajá port, each button's `onClick` calls one of:

```ts
openCloneDialog();
openOpenRepoDialog();
openInitRepoDialog();
```

— all three coming from #100's exports. Sub-PR 3 of #135 should land **after** #100 to wire these up; until #100 lands, the buttons can render as disabled with a tooltip pointing at the issue.

## Layout

GK's NEW tab body (skeleton from bundle:330400-330470 + visual inspection):

```
┌────────────────────────────────────────────────────┐
│                                                    │
│         New Tab                                    │
│         (Ctrl+T)                                   │
│                                                    │
│   [ Clone repo ]  [ Open repo ]  [ Init repo ]    │
│                                                    │
│   Recently opened                                  │
│   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐     │
│   │ repo1  │ │ repo2  │ │ repo3  │ │ repo4  │     │
│   └────────┘ └────────┘ └────────┘ └────────┘     │
│   ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐     │
│   │ repo5  │ │ repo6  │ │ repo7  │ │ repo8  │     │
│   └────────┘ └────────┘ └────────┘ └────────┘     │
│                                                    │
└────────────────────────────────────────────────────┘
```

For chajá: 4-column grid, each cell is a card with repo name, parent dir, last-opened relative timestamp ("2h ago"). Hover surfaces a delete-from-recents action.

## Closed-tab behavior

When a NEW tab is closed, it does NOT enter the closed-tabs stack — there's nothing to reopen. The reducer at `bundle:1795+` drops NEW-type tabs from the `TabsClosed` payload before passing to the `closedTabs` handler.

(This is inferred — the bundle code path for NEW-type close is buried inside `consumeTabOperations`'s CLOSE branch. Cross-validate during sub-PR 3 implementation.)

## Cross-validation

Two claims worth re-grepping:

1. **`RECENTLY_OPENED_LIMIT = 8` exact** — confirmed at bundle:182648. Don't pick another number for the grid size.
2. **`getRecentLocalReposWithoutCurrentlyOpenRepo` is the right selector** — confirmed at bundle:352645. Using `getRecentLocalRepos` (without the filter) would surface the currently-open repo in its own NEW tab's grid, which is a UX bug (clicking it would no-op via `switchToRepoTabIfItExists`).
