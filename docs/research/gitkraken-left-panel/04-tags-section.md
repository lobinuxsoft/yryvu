# TAGS section

Pure git data — `git tag` and `git for-each-ref refs/tags/`. Auto-hidden
when no tags exist (unless the user has touched the section's
visibility — see doc 00 on the `toggledSections` override).

## Selectors (file `/11646`)

```js
getUnfilteredTags = createSelector(
  getRefsByFullName,
  flow(toArray, filter(isRefATag)));   // every ref where type === "tag"

getFilteredTags = createSelector(
  getFilteredRefs,                     // refs after global filter
  filter(isRefATag));

getTagsByKey = createSelector(
  getUnfilteredTags,
  flow([
    map(({fullName, ...rest}) => [getTagKeyFromFullName(fullName), {fullName, ...rest}]),
    fromPairs]));

getTagDepthsByKey = createSelector(
  getTagsByKey,
  mapValues(({name}) => split("/", name).length - 1));

// Folders share their key namespace per depth (so v1.0/v1.0.1 → folder "v1.0").
getFolderKeyFromTagNameAndDepth = (Ve, at) => flow([
  split("/"),
  take(at + 1),
  join("-"),
  V => `TAGS-${V}`,
])(Ve);

getTagFolderNamesByKey = createSelector(getTagsByKey, getTagDepthsByKey,
  (tags, depths) => /* per-tag folder ancestor names */);

getTagNamesByKey = createSelector(getTagsByKey, getTagDepthsByKey,
  (tags, depths) => mapValues to short name relative to its parent folder);

getTagRowNamesByKey = createSelector(
  getTagFolderNamesByKey, getTagNamesByKey, merge);

// SemVer detection — for ordering / grouping.
getIsRangeByKey  = createSelector(getTagRowNamesByKey, mapValues(semver.validRange));
getIsSemverByKey = createSelector(getTagRowNamesByKey, mapValues(semver.valid));
getRangeByKey    = createSelector(getTagRowNamesByKey, getIsRangeByKey,
  (names, isRange) => /* { [key]: new semver.Range(name) | null } */);

// Row builder.
getTagRows = createSelector(
  getIsLeftPanelHandleDragging,
  getUnfilteredTags,
  getFilteredRefNamesToFuzzyStrings,
  getCollapsedBranchFolders,
  getIsSoloing, getIsSemverByKey, getRangeByKey, getTagRowNamesByKey,
  getIsInUnsupportedRebase, getRefsTree, getRepoPath,
  (isDragging, tags, fuzzy, collapsed, isSoloing,
   isSemver, range, names, isRebase, tree, repoPath) =>
    map(({ containsCheckedOutRef, folderName, folderPathWithFuzzyDelimiters,
           depth, isCollapsed, ref, sectionKey }) =>
      folderName
        ? makeFolderRow({
            folderPath: folderPathWithFuzzyDelimiters,
            folderName,
            collapsedFolders: collapsed,
            sectionKey, depth,
            isLeftPanelSoloing: isSoloing,
            isHidden: isRefHidden(tree.refs, `refs/tags/${folderPathWithFuzzyDelimiters}`),
            isSoloed: isSoloing && isFolderSoloed(/*tag-name list*/),
            isCollapsed, containsCheckedOutRef,
            folderType: "tag",                       // ← differs from LOCAL/REMOTE
            isParentHidden: false,
            repoPath,
          })
        : makeTagRow(ref, /*…*/),
      organizeRefsIntoFolders({ refs: tags, sectionKey: TAGS,
                                collapsedFolders: collapsed, namesToFuzzyStrings: fuzzy }))
);
```

## Tag row anatomy

```
[indent (depth × 16 px)]
[chevron OR spacer]    [eye-toggle]    [tag-icon]    [name]
```

**Lightweight vs annotated**: tag rows in GK *do not* visually
differentiate lightweight (just a ref) from annotated (a tag object
with message + tagger). Same icon, same row chrome. The only
indication is the hover tooltip, which shows the **annotation
message** (or nothing for lightweight).

## SemVer-aware grouping

The bundle computes `isSemver` and `range` for every tag, but the
*observed* use of these is just sorting — there's no UI affordance
to "filter by range" or "show only stable releases". The tag list
is still rendered in alphabetical / folder order, with semver only
breaking ties or grouping `v1.0.0`-style tags into a `v1.0`-style
folder when GK detects the slash-pattern.

If a tag name has slashes (`v1.0/rc1`), GK *folders* the tag the
same way as branches: `v1.0/` folder containing `rc1`. The
`folderType: "tag"` tells the folder row to render a tag-style
icon instead of a branch icon.

## Hide-all / show-all

```js
case TAGS:
  yield call(showAll ? showAllTags : hideAllTags);
```

The `hideAllTags` and `showAllTags` sagas live in `/56922` (not
shown). They flip every tag's `hiddenRefs` membership.

## Context menu (per tag row)

Available actions extracted from i18n strings (`ContextMenu-…`) and
verified by `popupTagMenu` saga:

```js
popupTagMenu = (tag, sectionKey, tagName) => ({ saga: function*(dispatch){
    const sha     = tag.sha;
    const headRef = yield select(getHeadRef);
    if (!headRef) return;
    const isOnHead   = sha === headRef.sha;
    const groupedRef = tag.groupedRefs[0];
    const remoteNames= yield select(getRemoteNames);
    const repo       = yield select(getRepo);
    // mergeState used to gate "Merge into HEAD"
    const fwdMerge   = yield call(getMergeState, repo, groupedRef.sha, headRef.sha);
    const bwdMerge   = yield call(getMergeState, repo, headRef.sha,    groupedRef.sha);
    /* … builds menu using buildTagContextMenu(...) — body trimmed */
});
```

Menu entries (i18n keys observed):

| Key | Action |
|-----|--------|
| `ContextMenu-CheckoutTag` | `git checkout <tag>` (detaches HEAD) |
| `ContextMenu-CreateBranchHere` | new branch from this tag |
| `ContextMenu-CreateAnnotatedTag` | new annotated tag at this commit |
| `ContextMenu-AnnotateTag` | add/edit annotation message on this tag |
| `ContextMenu-PushTagToRemote` | `git push <remote> <tag>` (specific remote) |
| `ContextMenu-Delete` / `ContextMenu-DeleteTagXLocally` | `git tag -d <tag>` |
| `ContextMenu-DeleteTagFromRemote` / `ContextMenu-DeleteTagXFromRemoteY` | `git push --delete` |
| `ContextMenu-DeleteTagXFromAllRemotes` | broadcast delete to every remote |
| `ContextMenu-CopyTagName` | clipboard write |
| `ContextMenu-CopyDeepLinkForTag` / `ContextMenu-CopyDeepLinkForTagOnRemote` | GK deep-link — **OUT OF SCOPE** for chajá (their `gitkraken://…` URI scheme) |
| `ContextMenu-MergeBranchIntoBranch` (when applicable) | merge tag commit into HEAD |

The `CopyDeepLink*` entries write a `gitkraken://link/...` URL — a
private URI scheme handled by the GK desktop client. **Skip them.**
chajá can implement its own `chaja://...` deep links if it wants,
but those wouldn't interop with GK.

## Header

```js
getTagHeaderProps = createSelector(
  getFilteredTagCount /*denominator*/,
  getFilteredVisibleTagCount /*numerator*/,
  getIsLeftPanelFiltering, getIsSectionExpandedByKey, getTranslationFn,
  …);
```

No add-button (tags are created from the graph, not from this
header). No refresh button (tags are immediate from the local repo
state). Right-click on the header opens the per-section menu (see
doc 10).

## chajá implementation hint

- New backend op needed: `list_tags(repo)` returning `{fullName,
  name, sha, isAnnotated, message, taggerName, taggerEmail,
  taggedAt}` per tag. `gix` exposes this through the reference
  iterator filtered to `refs/tags/`; annotation data is one extra
  object lookup per ref.
- Reuse the `organizeRefsIntoFolders` helper — same one as
  LOCAL/REMOTE, just pass `sectionKey: "TAGS"` and `folderType:
  "tag"`.
- Implement the hover tooltip showing the annotation message; for
  lightweight tags show "lightweight tag" or just nothing.
- Add the deep-link menu items only if chajá ever defines a URI
  scheme. Otherwise omit those rows; the rest of the menu is
  pure-git and trivial.
- The semver detection is marginal value at v1 — GK has it but
  doesn't seem to use it for much. Skip until a feature actually
  needs it (e.g. "show only releases matching ^1.0").
