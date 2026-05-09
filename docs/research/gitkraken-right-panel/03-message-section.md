# Message section — plain text + emojify

GitKraken's commit message rendering in the inspector is **deliberately
minimal**: subject in `<p>`, body in `<pre>` with word-break, emoji
shortcodes converted to unicode, and nothing else. No markdown, no
linkification of URLs, no issue-reference hyperlinks, no
conventional-commit type parsing.

This is actually a notable product choice — yryvu can match it or do
better (linkify issues, render markdown). But for 1:1 parity, match.

## Component structure

```jsx
// classes
className = classnames("commit-message-view", "pb1", {
  "editable-message": isEditable
})

<div className="commit-message-view pb1 [editable-message]"
     data-testid="commit-message-container"
     onClick={onEditableMessageClick}
     style={{height: "100%"}}>

  {isRebasing && (
    <span data-testid="commit-message-rebase-info">
      {translate("Rebasing-CommitLabel", currentStep, totalSteps)}
      {/* "Commit {0} of {1}" in rebase mode */}
    </span>
  )}

  <div className="commit-message-text">
    <p data-testid="commit-message-summary">
      {emojify(summary)}
    </p>
    <pre data-testid="commit-message-description"
         style={{wordBreak: "break-word"}}>
      {emojify(description)}
    </pre>
  </div>
</div>
```

## Subject / body split

```js
getCommitMessageSummary = (message) => {
  // first line up to LF or CR
  let acc = "";
  for (const c of message) {
    if (c === "\n" || c === "\r") return acc;
    acc += c;
  }
  return acc;
}

getCommitMessageDescription = (message, sep = "\n") => {
  // strip everything up to (and including) at most 2 leading newlines
  const re = new RegExp(`^.*(:?${sep}){0,2}`, "m");
  return message.replace(re, "");
}
```

This is the classic git convention: subject = first line, body = rest
after the blank separator line. Trailing content after the subject's
blank line is the body. If the message has no blank line, the body is
just whatever follows the first newline.

## Emojify

Shortcodes like `:fire:`, `:bug:` get replaced with their unicode
equivalents via an `emojify(str)` helper. Both subject and body go
through it. No other markdown handling — `**bold**`, code fences, etc.
render literally.

## Monospace? Markdown? Links?

Observed: **no** markdown parsing, **no** URL linkification, **no** issue
reference linkification (`#123` stays plain text), **no** GFM features,
**no** conventional-commit parsing.

The `<pre>` tag for the body gives monospace but **with `word-break:
break-word`**, so long strings wrap instead of horizontal-scrolling.
No line-length hint (72 char ruler, etc.).

The `<p>` tag for the subject is proportional font.

## Editable mode (`editable-message`)

Clicking the container when `editable-message` class is active triggers
`onEditableMessageClick`. This is used in the **reword** flow (during an
interactive rebase), not on normal commits. When entering reword mode,
GitKraken swaps the `<p>/<pre>` pair for `<input>/<textarea>`:

```jsx
<div className="reword-commit-message-summary">
  <input autoFocus
         data-testid="reword-summary-input"
         onChange={onChangeSummary}
         placeholder={t("CommitMessage-SummaryPlaceholder")}
         spellCheck={...}
         type="text"
         value={summary}/>
  <span className={charCountClasses}>{charCount}</span>
</div>
<textarea className="reword-commit-message-description"
          data-testid="reword-description-input"
          onChange={onChangeDescription}
          placeholder={t("CommitMessage-DescriptionPlaceholder")}
          spellCheck={...}
          style={{resize: "both"}}
          value={description}/>
```

Keybinds registered inside the editor:
- `Cmd/Ctrl+Enter` — commit (saves the reword).
- `Cmd/Ctrl+Shift+Enter` — alt submit.

Both forwarded to the native handler (`"native!"`).

## Tooltip wrapper (amend preview)

When the message is rendered in the amend-previous-commit preview,
the whole block is wrapped in an `OverlayTrigger` with a tooltip:
`AmendPreviousCommitMessageTooltip`. Delay: 250 ms. Placement: left.

## No "show more" truncation

Searched for show-more / truncate / ellipsize affordances on the body
— none found. Long commit messages render fully, relying on the panel's
scroll container to handle overflow. There's no "click to expand" UX.

## Conventional-commit parsing

Not done. Messages like `feat(graph): add lane hover` render as plain
text — no colored "feat" badge, no scope highlight.

If yryvu wants conventional-commit awareness, that's a deviation —
worth considering because the spec is ubiquitous in modern OSS, but
not a port blocker.

## Yryvu implications

1. **Split algorithm**: first LF → subject, rest → body (after the blank
   line). Trivial string ops, no regex magic needed.
2. **Render `<p>` for subject, `<pre>` with `word-break: break-word`
   for body**. Monospace body, proportional subject. Match GK exactly
   or break toward fully-proportional (more readable for non-code
   commit messages).
3. **Emoji shortcodes**: run the whole message through an emojify step.
   Yryvu can use `emoji-name-map` or just a small lookup table for the
   top ~200 common ones.
4. **Do NOT linkify URLs or issue references** for 1:1 parity. Worth
   noting as a possible yryvu improvement (`#123` → open issue in
   Linear/GitHub, with repo-level issue-tracker config). If added,
   make it opt-in.
5. **Do NOT parse markdown**. `**bold**` stays `**bold**`.
6. **No truncation / show-more** — let the message flow and the
   scroll container handle it.
7. For reword mode (#interactive-rebase): the DOM swaps to
   input/textarea. Out of scope for the basic inspector issue, but
   keep the CSS class name pattern (`reword-commit-message-*`)
   available for that future feature.

## Source

Bundle: same.

- `getCommitMessageSummary=Ve=>(dn||(dn=(0,ln.default)((Ve=>{let at=""; for(const ct of Ve){ if("\n"===ct||"\r"===ct)return at; at+=ct } return at;}))), dn(Ve))` — subject extractor.
- `getCommitMessageDescription=(Ve,at="\n")=>{ const ct=new RegExp(`^.*(:?${at}){0,2}`,"m"); return hn(Ve, ct) }` — body extractor.
- `getCommitMessageCoauthors = … /^co-authored-by:\s*([^\s<>]+(?:\s+[^\s<>]+)*)\s*<([^<>]+)>/gim …` — coauthor extractor (covered in doc 04).
- `className:"commit-message-text"`, `data-testid:"commit-message-summary"` / `"commit-message-description"` — DOM classes.
- `emojify` — helper in the same utils module.
- `wordBreak:"break-word"` on the `<pre>` — layout.
- `"editable-message"` conditional class + `reword-commit-message-*` for reword mode.
