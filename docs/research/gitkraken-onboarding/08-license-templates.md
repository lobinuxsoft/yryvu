# 08 — License template picker

## How GK populates the dropdown

`bundle:118938-118947`:

```js
at.getLicenseOptionsObject = () => (
  _allLicensesObject ||
  (_allLicensesObject = {},
   Object.keys(mn.default).forEach((key) => {
     _allLicensesObject[key] = { ...cloneDeep(mn.default[key]), key };
   })),
  _.cloneDeep(_allLicensesObject)
);

at.getLicenseOptionsArray = () => (
  _allLicensesArray ||
  (_allLicensesArray = Object.keys(mn.default).map((key) => ({
    ...cloneDeep(mn.default[key]),
    key,
  })),
  _allLicensesArray = _.sortBy(
    [(opt) => opt.key === "_copyright-notice" ? 0 : 1, "title"],
    _allLicensesArray,
  )),
  _.cloneDeep(_allLicensesArray)
);
```

`mn.default` is module 56643. The actual contents map at
`bundle:212316`:

```js
Ve.exports["_copyright-notice"] = ct(4480),
Ve.exports["agpl-3.0"]   = ct(35699),
Ve.exports["apache-2.0"] = ct(64870),
Ve.exports["artistic-2.0"]= ct(58835),
Ve.exports["bsd-2-clause"]= ct(99601),
Ve.exports["bsd-3-clause"]= ct(12904),
Ve.exports["cc0-1.0"]    = ct(67987),
Ve.exports["epl-1.0"]    = ct(95786),
Ve.exports["gpl-2.0"]    = ct(60125),
Ve.exports["gpl-3.0"]    = ct(94910),
Ve.exports.isc           = ct(56604),
Ve.exports["lgpl-2.1"]   = ct(52470),
Ve.exports["lgpl-3.0"]   = ct(45082),
Ve.exports.mit           = ct(57883),
Ve.exports["mpl-2.0"]    = ct(26911),
Ve.exports["ofl-1.1"]    = ct(68089),
Ve.exports["osl-3.0"]    = ct(48253),
Ve.exports.unlicense     = ct(96131);
```

So GK ships **18 license options** + a special `_copyright-notice` entry
that sorts to the top (the "no license, just a copyright notice" case).

## License entry shape

Each license module exports an object roughly:

```js
{
  title:    "MIT License",
  contents: "Copyright (c) [year] [username]\n\nPermission is hereby ...",
  // potentially: spdx, url, etc.
}
```

The dropdown uses `labelKey: "title"` and `valueKey: "key"`
(`bundle:286149` `labelKey: "title", valueKey: "key"`), so the
dropdown displays the friendly title and the form stores the SPDX-ish
key.

## Tag replacement on commit

Before writing `LICENSE.md`, the saga calls
`replaceLicenseTagsWithRelevantData(contents)` (`bundle:132550`):

```js
function* replaceLicenseTagsWithRelevantData(contents) {
  const email = (yield select(getConfigEmail)) || "";
  const name  = (yield select(getConfigName))  || "";
  const year  = (new Date).getFullYear().toString();
  return contents
    .replace(/\[email\]/g, email)
    .replace(/\[username\]/g, name)
    .replace(/\[year\]/g, year);
}
```

Three tags: `[email]`, `[username]`, `[year]`. Source values come from
the user's git config (`user.email` / `user.name`) — same fields the
commit-author block uses.

## Sort order in dropdown

`_copyright-notice` first (always), then by `title` ascending. So MIT
appears alphabetically — if the user's most-likely choice is MIT, GK
doesn't put it first; it relies on alphabetical fall-through.

## Triage: how chajá ships this

### KEEP: bundle a curated set

Mirror GK with the same 18 entries, sourced from
`github/choosealicense.com` (which is itself the canonical source for
the templates GK ships) under MIT (their site source) / CC-BY (their
license texts).

- The licenses **themselves** are not copyrightable. The text comes
  from each license's authoritative text (GPL from FSF, MIT from open
  spec, etc.). Distribute the texts verbatim — no license issue.
- choosealicense.com's curated metadata (description / permissions /
  conditions / limitations) IS CC-BY. We don't need that metadata for
  v1; we only need the raw text.

### Plan

1. Add `apps/chaja-app/src-tauri/templates/licenses/<key>.txt` resources.
2. Add `apps/chaja-app/src-tauri/templates/licenses/index.json`:

   ```json
   [
     { "key": "mit", "title": "MIT License", "spdx": "MIT", "tags": ["[year]","[fullname]"] },
     { "key": "apache-2.0", "title": "Apache License 2.0", "spdx": "Apache-2.0", "tags": ["[year]","[fullname]"] },
     ...
   ]
   ```

3. Backend command `list_license_templates() -> Vec<LicenseTemplate>`
   reads `index.json` once at startup.
4. Backend command `init_repository(... license_key: Option<String>
   ...)` resolves key to file, reads, runs tag substitution against
   the user's git config (`user.email` / `user.name`) + current year,
   writes to `<workdir>/LICENSE.md`.
5. Tag substitution: same three GK tags. Use **`[fullname]`** instead
   of `[username]` because that's the standard convention (matches
   choosealicense.com canonical templates).

   chajá deviation: choosealicense.com uses `[year] [fullname]`
   instead of GK's `[year] [username]`. Both forms commonly appear; we
   pick the choosealicense convention because it's the upstream
   canonical. **FLAG: noted for the implementation hints doc.**

### Default option

"(none)" first in dropdown. Saga skips LICENSE.md write step when
license is null. Mirror GK's `_copyright-notice` -> "(none)" mapping.

## License list to ship in v1

Match GK's set:

```
mit, apache-2.0, gpl-3.0, agpl-3.0, lgpl-3.0, gpl-2.0, lgpl-2.1,
bsd-2-clause, bsd-3-clause, isc, mpl-2.0, epl-1.0, osl-3.0,
artistic-2.0, cc0-1.0, ofl-1.1, unlicense
```

(17 entries; `_copyright-notice` has been replaced by the "(none)"
option in the dropdown rather than a templated copyright notice file.)

## Cross-validation

```
$ grep -n "agpl-3.0\|apache-2.0" /tmp/gk-bundle-pretty.js
212316: Ve.exports["_copyright-notice"] = ct(4480), Ve.exports["agpl-3.0"] = ct(35699), Ve.exports["apache-2.0"] = ct(64870), ...
$ grep -n "replaceLicenseTagsWithRelevantData" /tmp/gk-bundle-pretty.js
132550: function* replaceLicenseTagsWithRelevantData(Ve) {
132602: const Ve = yield(0, Dn.call)(replaceLicenseTagsWithRelevantData, mn.contents), at = ...
```

Confirmed. The license set is exact (18 entries via `212316`).

## chajá deviation FLAGs

1. **Tag name:** `[fullname]` instead of GK's `[username]`. Matches
   upstream choosealicense.com convention; safer for users who paste
   external license templates.

2. **No `_copyright-notice` entry.** The "(none)" option in the dropdown
   does the same job — skips LICENSE.md generation entirely. Cleaner
   UX than GK's pseudo-license.
