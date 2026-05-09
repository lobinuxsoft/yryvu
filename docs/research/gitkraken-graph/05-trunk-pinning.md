# Trunk pinning

GitKraken's "pin branch to left" feature forces a chosen branch's first-parent
chain to occupy column 0, giving the trunk a stable vertical spine.

**Key finding: pinning is 100% manual user action. There is no auto-pin
heuristic.** When the user hasn't pinned any branch, the allocator behaves
like a plain leftmost-free allocator — lane 0 drifts to whichever branch
happens to claim it first.

## User-facing trigger

Context menu on any ref pill:
- `ContextMenu-PinBranchToLeft`
- `ContextMenu-UnpinBranchFromLeft`

Clicking dispatches Redux action `setPinnedBranchFullName(fullName)` which
persists to `repoSetting.pinnedBranchFullName`. Per-repo, not global.

## Precomputation of `pinnedBranchShas`

Runs once at the start of each `loadRowsbySha` invocation (the row-loading
pass that precedes layout):

```python
def build_pinned_set(graph_rows, pinned_full_name):
  pinned_shas = set()
  if pinned_full_name is None:
    return pinned_shas

  cursor = None

  # 1. Find the row that carries the pinned branch as a ref.
  for row in graph_rows:
    if cursor is None:
      has_pinned = any(h.id == pinned_full_name for h in row.heads) \
                or any(r.id == pinned_full_name for r in row.remotes)
      if not has_pinned:
        continue
      cursor = row.sha

    # 2. Walk first parents from that row.
    if row.sha == cursor:
      pinned_shas.add(row.sha)
      cursor = row.parents[0] if row.parents else None
      if cursor is None:
        break

  return pinned_shas
```

The resulting set is handed to the column allocator (see `01-lane-allocator.md`),
which forces column 0 for every sha in the set.

## Edge cases

- **Pinned ref deleted**: `getPinnedBranchFullName` selector returns `null`
  for a ref that no longer exists. The allocator falls back to pure
  leftmost-free mode.
- **Pinned ref exists but row not reached yet** (streaming case): the cursor
  never engages and the set stays empty. This would cause the trunk to
  briefly drift until the pinned ref's row loads.
- **Merge commit on pinned chain**: only the first parent is followed, so
  merged-in side branches are excluded. Consistent with `git log --first-parent`.

## Yryvu proposal: auto-pin fallback

GitKraken's "manual-only" behavior is a UX miss — users expect the trunk to
stay on the left without configuration. Proposed Yryvu behavior:

1. If the user has explicitly pinned a branch for this repo, use that.
2. Else, auto-fallback in this order:
   - Default branch from remote HEAD symref (`refs/remotes/origin/HEAD`
     peeled).
   - Local HEAD, if attached to a named branch.
   - The first ref with the most "trunk-looking" name (`main`, `master`,
     `development`, `trunk`).
3. Expose a "pin this branch" context menu entry for manual override.

Auto-pin results must be invalidated and recomputed whenever refs change
(create/delete/move branch, fetch, rename HEAD).

## Yryvu implementation sketch

```rust
// In yryvu-bridge::repo::commits after topo_sort_children_first
let pinned_head = pick_pinned_branch(&repo)?;         // auto or from settings
let pinned_shas = build_pinned_set(&rows, &pinned_head);

// Pass pinned_shas into the LaneAssigner constructor so it can check
// membership during claim_lane_for.
let mut assigner = LaneAssigner::with_pinned(palette_size, pinned_shas)?;
```

Where `build_pinned_set` mirrors the pseudocode above: scan rows for the
first row carrying the pinned ref, then walk `parents[0]` until exhaustion.

## Source locations

Bundle: same file.

- `setPinnedBranchFullName` — Redux action (offset ~342781 / ~6280636).
- `getPinnedBranchFullName` — selector (offset ~5535387).
- `ContextMenu-PinBranchToLeft` / `-UnpinBranchFromLeft` — menu keys
  (offset ~4561157).
- `loadRowsbySha` — orchestrator that rebuilds `pinnedBranchShas` each call
  (offset ~11898186).
- `unpinBranchFromLeft` — cleanup on ref delete (offset ~6321891).
