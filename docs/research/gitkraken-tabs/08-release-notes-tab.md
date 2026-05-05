# RELEASE_NOTES Tab

The `RELEASE_NOTES` transient tab type renders the in-app changelog. It opens via menu action (no default keybind) or auto-opens on app launch when the bundled `releaseNotesVersion` doesn't match `lastReleaseNotesDisplayed` in the user's profile.

## Open saga (bundle:2603-2620)

```js
at.openReleaseNotes = () => ({
    saga: function* openReleaseNotesSaga(Ve) {
        const at = yield(0, mn.select)(Ma.getCurrentTab);
        if (at && at.type === Oa.tabTypes.RELEASE_NOTES) return;
        const ct = yield(0, mn.select)(Ma.getTabs),
              dt = lodash.findIndex((Ve => lodash.get(["type"], Ve) === Oa.tabTypes.RELEASE_NOTES), ct);
        dt > -1 ? yield Ve.call(performTabOperation, {
            type: Oa.tabOperationTypes.SWITCH_TO,
            tabId: ct[dt].id
        }) : yield Ve.call(performTabOperation, {
            type: Oa.tabOperationTypes.CREATE,
            switchToCreatedTab: !0,
            tabParams: {
                type: Oa.tabTypes.RELEASE_NOTES,
                version: ba.releaseNotesVersion
            }
        })
    }
});
```

Three branches:

1. **Already on the RELEASE_NOTES tab**: no-op (early return).
2. **A RELEASE_NOTES tab exists elsewhere in the strip**: `SWITCH_TO` it. Singleton enforced — only one RELEASE_NOTES tab can be open at a time.
3. **No RELEASE_NOTES tab open**: `CREATE` one with `version: ba.releaseNotesVersion`.

The `version` field is captured at create time — if the user has the tab open and updates GK to a new version, the tab keeps showing the OLD version's changelog until reopened.

## Version source (bundle:408507)

```js
Ve.exports = JSON.parse('{"releaseNotesVersion":"12.0.1"}');
```

This JSON module ships in the bundle and is the source of truth for "what version is this app". Embedded as a separate module rather than a constant so the bundler can swap it at build time.

For chajá, the equivalent is `apps/chaja-app/src-tauri/tauri.conf.json` `package.version` — readable from Tauri via `getVersion()`. Use that as the seed instead of bundling a separate JSON.

## Auto-open on launch (bundle:55942-55968)

```js
const An = yield(0, hn.select)(jn.getCurrentProfileRememberTabs),
      Dn = yield(0, hn.select)(Nr.getLastReleaseNotesDisplayedVersion),
      Fn = Vr.releaseNotesVersion !== Dn;
// ... if Fn (version differs), open RELEASE_NOTES tab
yield(0, hn.put)(setAppSetting(["lastReleaseNotesDisplayed"], Vr.releaseNotesVersion));
```

Logic:
1. Read `lastReleaseNotesDisplayed` from app settings.
2. Compare with current `releaseNotesVersion`.
3. If different, dispatch `openReleaseNotes()` and update `lastReleaseNotesDisplayed`.

The `getCurrentProfileRememberTabs` selector likely gates this with a "show release notes on update" preference.

For chajá, store `lastReleaseNotesDisplayed` in `preferences.json` under `general.lastReleaseNotesDisplayed`. Compare against Tauri's `getVersion()` at app boot. Default behavior: show on first run + on any version change.

## Content rendering

The bundle does NOT contain inline release-notes markdown. The `RELEASE_NOTES` tab component (not located in this audit pass — likely a lazy-loaded chunk) fetches the changelog from a GK service URL keyed by version. Possibilities:

- HTTP fetch to `https://api.gitkraken.com/release-notes/{version}` (proprietary endpoint).
- Embedded markdown in a separate chunk loaded on-demand.
- Bundled JSON keyed by version.

For chajá, the simplest path:
1. Ship a `CHANGELOG.md` in the repo (release-please already maintains this).
2. The RELEASE_NOTES tab loads `CHANGELOG.md` via Tauri's `tauri::path::resource_dir()` + read.
3. Renders via the existing markdown renderer (already needed for #60 per-filetype renderer dispatcher; if not present yet, port `marked` or `markdown-it`).
4. Anchor-jumps to the `## [version]` heading matching the tab's `version` field.

Alternative: GitHub releases API (`gh release view {version}`) for fetched content — but this adds a network dependency and only works for tagged releases.

## UX details

- The tab pill icon is FontAwesome `fas clipboard-list` (bundle:142790, 375641).
- The tab title is "Release Notes" (i18n key `TabsBar-ReleaseNotesTitle`).
- The tooltip shows the version chip (FontAwesome `far tag` icon + version string, bundle:142794-142798).
- Closing the tab is normal CLOSE — version preference unchanged. Reopening creates a new tab with the CURRENT bundled version (not the one you closed).

## Cross-validation

Two claims worth re-grepping:

1. **Singleton enforcement** — confirmed at bundle:2607 via `findIndex` early return. The reducer doesn't enforce this; it's enforced at the saga layer. Don't simplify by removing the `findIndex` check, or repeated triggers will accumulate tabs.
2. **`version` is captured at create time, not live** — confirmed at bundle:2614 (`version: ba.releaseNotesVersion`). The tab record stores the version, the renderer reads from the record. A long-running app session that auto-updates GK in-place won't refresh open RELEASE_NOTES tabs to the new version until they're closed and reopened.
