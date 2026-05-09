# 07 — gitignore template picker

## How GK populates the dropdown

Source at `bundle:118918-118937`:

```js
at.getGitIgnoreOptions = () => {
  if (Rn._gitIgnoreOptions) return _.cloneDeep(Rn._gitIgnoreOptions);
  const dir = path.join(global.appPath, "src", "templates", "gitignore");
  Rn._gitIgnoreOptions = fs.readdirSync(dir)
    .filter(_.includes(".gitignore"))
    .map((filename) => ({
      label: filename.substring(0, filename.indexOf(".gitignore")),
      value: path.resolve(dir, filename),
    }));
  return _.cloneDeep(Rn._gitIgnoreOptions);
};
```

Two key facts:

1. **Templates are bundled with the app**, not fetched from the
   internet. Path: `<appPath>/src/templates/gitignore/*.gitignore`.
2. The list is **the GK-bundled gitignore set**, NOT GitHub's
   `github/gitignore` repo. They are likely **derived** from the
   `github/gitignore` repo (Public Domain via Creative Commons CC0)
   but bundled into the app for offline use.

The dropdown options have shape `{ label, value }`:

- `label` = filename without `.gitignore` extension (e.g. `Node`,
  `Python`, `VisualStudio`).
- `value` = absolute path to the `.gitignore` file on disk. Used by
  the saga to copy verbatim into `<workdir>/.gitignore`.

## What the saga does with the chosen template

`setUpInitialCommitFiles` at `bundle:132610`:

```js
if (gitIgnorePath) {
  const dest = yield call(getGitignorePathFromRepo, repo);  // <workdir>/.gitignore
  yield call([fs, fs.copy], gitIgnorePath, dest);
  if (process.platform === "win32") {
    yield call([fs, fs.chmod], dest, "0644");
  }
  staged.push(".gitignore");
}
```

Plain file copy. No template-tag substitution (unlike the license
flow). Just copy bytes.

## Triage: how yryvu ships this

Three options:

### Option A: Bundle templates with yryvu (mirror GK)

**KEEP** as the v1 approach. Source the templates from the upstream
`github/gitignore` repo (CC0 — license-compatible with yryvu's AGPL).

Plan:

1. Add `apps/yryvu-app/src-tauri/templates/gitignore/` to the Rust
   bundle resources.
2. Curate ~20 most-used templates (Node, Python, Rust, Go, Java, C++,
   VS, VSCode, JetBrains, macOS, Windows, Linux, etc.) — full set is
   hundreds, overkill.
3. Backend command `list_gitignore_templates() -> Vec<{ name, path }>`
   reads the bundled directory at startup, caches in a `OnceLock`.
4. Backend command `init_repository(... gitignore_template: Option<String>
   ...)` resolves `name` to `path` and copies into `<workdir>/.gitignore`.
5. License header in each bundled template: per github/gitignore CC0
   notice. Ship a `LICENSE.gitignore-templates` file in the resources
   dir crediting the upstream.

### Option B: Fetch from github/gitignore at runtime

SKIP. Adds network dependency for offline-installed users; defeats the
"clone works on a plane" UX target.

### Option C: User-supplied template path

**FLAG / future.** Could add a "Custom .gitignore…" option that opens a
file picker, lets user point at any local `.gitignore` they want copied.
Defer to follow-up issue.

## yryvu implementation hint

Tauri resource paths: declare in `src-tauri/tauri.conf.json` under
`bundle.resources` and resolve at runtime via
`AppHandle.path().resolve(...)`. That keeps the templates in the app
bundle (~50KB total for 20 templates) and out of any user-config dir.

```json
"bundle": {
  "resources": ["templates/gitignore/*.gitignore"]
}
```

Backend reads via `app.path().resolve("templates/gitignore",
BaseDirectory::Resource)`.

### Default option

Mirror GK: render a "(none)" entry first in the dropdown so the user
can opt out of the gitignore entirely. The saga already handles this
(if `gitIgnorePath` is null, skip the copy step).

## Cross-validation

```
$ grep -n "templates/gitignore\|getGitIgnoreOptions" /tmp/gk-bundle-pretty.js
118921: at.getGitIgnoreOptions = () => {
118933: const Ve = ln.default.join(global.appPath, "src", "templates", "gitignore");
$ grep -n "InitRepo-GitIgnoreTemplate" /tmp/gk-bundle-pretty.js
286136: label: ya("InitRepo-GitIgnoreTemplate"),
```

Confirmed.

## yryvu deviation FLAG

1. **Curated subset, not the full upstream.** GK ships hundreds of
   templates by inheriting all of `github/gitignore` plus some custom.
   yryvu ships ~20 most-used to keep the bundle small. If a user needs
   one we don't ship, they can paste the file post-init.
