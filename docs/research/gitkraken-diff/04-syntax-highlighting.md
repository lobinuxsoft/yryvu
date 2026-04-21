# Syntax highlighting — Monaco + Prism split

GitKraken uses **two** syntax highlighters depending on context:

- **Monaco's built-in tokenizer** inside the DiffEditor (and the
  CONTENT-mode text editor). Language resolved from the file path via a
  thin wrapper.
- **Prism.js** for everything outside Monaco — Markdown preview,
  inline code blocks, PR descriptions, commit-message preview, diff
  snippets in notifications.

No third highlighter in the bundle. No Shiki, no Highlight.js at the
render level.

## Monaco path — inside the editors

Models are created through a tiny wrapper:

```js
const createModel = (content, filePath) =>
  getMonaco().editor.createModel(
    content,
    getLanguageFromFilePath(filePath)
  );
```

`getLanguageFromFilePath(filePath)` returns a Monaco language ID
(`"typescript"`, `"javascript"`, `"rust"`, `"python"`, ...). It uses
Monaco's own filename-to-language registry — no custom extension
mapping, no shebang sniffing, no content detection:

```js
// pseudocode of getLanguageFromFilePath
const languages = monaco.languages.getLanguages();
const match = languages.find(l =>
  l.extensions?.some(ext => filePath.endsWith(ext)) ||
  l.filenames?.includes(basename(filePath))
);
return match?.id ?? "plaintext";
```

Monaco's registry ships ~90 languages by default via `monarch` grammars
compiled into the editor worker. Adding languages would require loading
`monaco-languages` chunks — GitKraken doesn't, so the language coverage
is "whatever Monaco ships".

## CRLF sanitization

Before handing content to Monaco, a hack strips carriage returns:

```js
const mn = createModel(globalReplaceCarriageReturnHack(original ?? ""), filePath);
const gn = createModel(globalReplaceCarriageReturnHack(modified ?? ""), filePath);
```

`globalReplaceCarriageReturnHack` replaces `\r\n` and bare `\r` with
`\n`. Monaco normalizes EOLs internally, but diff metrics (line counts,
selection ranges) depend on stable line endings. Without this
normalization, a CRLF file would have line numbers offset against the
back-end's LF view and staging line ranges would target the wrong
source lines.

The hack is invisible to the user — they still save as CRLF on
Windows if `core.autocrlf` is set; this is a render-only
normalization.

## Tab size

Per-model override:

```js
mn.updateOptions({ tabSize: ct });
gn.updateOptions({ tabSize: ct });
```

`ct` is a prop fed from user settings (`editor.tabSize`). Default is
Monaco's default (4). No per-file-type override in the bundle — tab
width is a global preference.

## Theming

Monaco themes are installed by the app's theme system (see doc 24 of
the graph research, round 4C). The diff editor inherits whichever theme
is active — there is no separate diff-only theme override.

Key theme tokens consumed by the diff editor:

- `diffEditor.insertedTextBackground` — green highlight for added lines.
- `diffEditor.removedTextBackground` — red highlight for removed.
- `diffEditor.insertedLineBackground` / `.removedLineBackground` —
  full-line tint (lighter than text backgrounds).
- `editor.background` / `.foreground` — editor body.
- `editorLineNumber.foreground` / `.activeForeground` — line number
  gutter.

GitKraken defines these in its theme JSON (loaded as
`monaco.editor.defineTheme(name, data)` at theme-setup time) and then
calls `monaco.editor.setTheme(name)` on theme change.

## Intra-line char changes

Monaco renders word-level diff inside changed lines using its own
`charChanges` result from `getLineChanges()` (see doc 03). The
highlighting is automatic — no extra decoration code in the bundle for
this. GitKraken uses Monaco's defaults: dimmed `insertedTextBackground`
for the line, full `insertedTextBackground` for the specific changed
spans.

## Prism path — outside the editors

Prism is bundled (see lines containing `Prism.languages.*`) with an
extensive set of language definitions directly in the render bundle —
dozens of grammars like `squirrel`, `rust`, `kotlin`, etc. inlined at
load time.

Invocation uses the standard Prism API:

```js
Prism.highlightElement(domNode);  // or
Prism.highlight(sourceText, Prism.languages[langId], langId);
```

Language detection from a class name: `language-<id>` on the element.
For Markdown preview rendering, the Markdown → HTML pipeline emits
`<code class="language-rust">…</code>` and Prism is invoked during
paint.

Why both:
- **Monaco is heavy** (2.9 MB + workers). Using it for every little code
  block would mean instantiating many editors for markdown preview,
  commit messages, etc. Performance-prohibitive.
- **Prism is light** (~100 KB including all grammars bundled). Perfect
  for read-only styled code where full editor capabilities (selection,
  find, edit) aren't needed.

So: editable or diff context → Monaco; read-only inline code → Prism.

## Chajá implications

- **Follow the same split**: Monaco for DiffEditor + Content editor;
  Prism (or Shiki for a modern alternative) for Markdown preview and
  any inline code rendering.
- **Do CRLF normalization in the render layer** before creating Monaco
  models. The Git backend gives us LF-normalized text already (our
  diff pipeline passes through `gix` / `git2-rs` which typically hand
  back LF), but defensive normalization still matters for cross-platform
  repositories.
- **Language detection = Monaco built-in** — call
  `monaco.languages.getLanguages()` at init, match by extension. Don't
  maintain our own extension→language map.
- **Tab size from user settings**, not per-file-type. If we want a
  chajá improvement later, `.editorconfig` respect is a natural fit
  (but GitKraken doesn't honor it — see the capability audit #33).
- **Theme tokens**: Monaco theme JSON should define the diff editor
  keys (`diffEditor.*`) even if the base editor keys are otherwise
  theme-system driven.
- **Do not port Prism's `squirrel` and similar obscure grammars** that
  nobody uses — Prism's default language list is sufficient. Chajá
  chooses which grammars to bundle.

## Source locations

Bundle: `/var/mnt/DATA/gitkraken-extract/app/src/render/static/entryPoints/main/render.bundle.js`

Grep patterns:

- `createModel=\(Ve,at\)=>getMonaco\(\)\.editor\.createModel` — the
  wrapper.
- `getLanguageFromFilePath` — the language resolver.
- `globalReplaceCarriageReturnHack` — CRLF sanitizer.
- `updateOptions\(\{tabSize:` — tab size per model.
- `Prism\.languages\.` — Prism grammars (many hits).
- `Prism\.highlightElement` — Prism invocation.

Monaco bundle: `/var/mnt/DATA/gitkraken-extract/app/src/render/static/monaco/monaco.js`
- Workers: `editor.worker.js`, `ts.worker.js`, `json.worker.js`,
  `html.worker.js`, `css.worker.js` — these host the language services
  (completions, diagnostics, formatting) but are idle for our diff use
  case (editor is read-only most of the time).
