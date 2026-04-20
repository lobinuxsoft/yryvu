# Lane allocator

GitKraken's column (lane) assignment is **not** append-only. It's a leftmost-free
allocator with three extra features: trunk pinning, forward reservations by
children, and a column-stealing heuristic.

## Data structures

Maintained across the single-pass walk over topologically-ordered rows:

- `columnsUsed: Record<column, bool>` — which columns currently carry an active
  edge line into the next row.
- `columnsToFreeWhenFound: Record<sha, column[]>` — deferred releases. When the
  walk reaches commit `sha`, the listed columns become free.
- `reserverInfoBySha: Record<sha, { type, newestDate, column }>` — reservations
  made by children for their parents. When the walk reaches `sha`, it honors
  the reservation if present.
- `pinnedBranchShas: Set<sha>` — precomputed first-parent chain of the pinned
  branch. Commits in this set are forced to column 0.
- `hasMergeNodeChildBySha: Record<sha, bool>` — populated during walk to
  prevent column stealing when a parent already has a merge child claiming it.

## Leftmost-free allocator

```
function allocColumn(columnsUsed, trunkPinActive):
  c = trunkPinActive ? 1 : 0   // skip column 0 when trunk is pinned elsewhere
  while columnsUsed[c]:
    c += 1
  columnsUsed[c] = true
  return c
```

When trunk pinning is active for this repo, column 0 is reserved for the
trunk — other commits start their search at column 1.

## Per-commit procedure

For each commit `commit` in topo order:

1. **Release deferred columns**: if `columnsToFreeWhenFound[commit.sha]`
   exists, free each listed column.

2. **Choose the column for this commit**:
   - If `commit.sha` is in `pinnedBranchShas`, force column 0 and mark
     `columnsUsed[0] = true`.
   - Else if there is a reservation for `commit.sha`, use it (and delete the
     reservation entry).
   - Else call `allocColumn(columnsUsed, trunkPinActive)`.

3. **Reserve columns for parents**:
   - First parent: tries to inherit the current commit's column (natural
     lane continuation). But if a pre-existing reservation targets a column
     **to the right** of the current one, "steal" the parent into the current
     (leftward) column and free the rightward one at the parent's eventual
     arrival. (See column stealing below.)
   - Extra parents (for merges): each gets its own fresh leftmost-free
     column (unless the parent is pinned, in which case it goes to 0).

## Column stealing

When processing a commit whose first parent `P` already has a reservation
at column `R_existing`, and the current commit's column `C_cur` is
**less than** `R_existing`:

- If `P` does not yet have a merge child claiming it
  (`!hasMergeNodeChildBySha[P]`):
  - Overwrite the reservation: `P` now reserves column `C_cur`.
  - Queue `R_existing` to be freed when `P` is reached
    (`columnsToFreeWhenFound[P] += [R_existing]`).
  - This is the "steal" that pulls parent lanes leftward and keeps the graph
    from drifting rightward over long histories.
- Otherwise queue `C_cur` to be freed at `P` (the existing reservation
  wins).

## Stash-beats-non-stash override

Reservations can be overridden when `existing.type === STASH` and
`commit.type !== STASH` **and** `reservation.newestDate > existing.newestDate`
(a newer non-stash reservation trumps an older stash reservation). Edge case,
but documented here for completeness.

## Pseudocode — full `getColumns(commit)`

```python
def get_columns(commit):
  # 1. Release deferred columns at this sha
  for col in columns_to_free_when_found.pop(commit.sha, []):
    columns_used.pop(col, None)

  # 2. Choose column
  reservation = reserver_info_by_sha.pop(commit.sha, None)
  if commit.sha in pinned_branch_shas:
    col = 0
    columns_used[0] = True
  elif reservation is not None and reservation.column is not None:
    col = reservation.column
  else:
    col = alloc_column(columns_used, trunk_pin_active)

  # 3. Reserve columns for parents
  for i, parent_sha in enumerate(commit.parents):
    existing = reserver_info_by_sha.get(parent_sha)

    if i == 0 and existing is not None and existing.column is not None and existing.column != col:
      # Consider stealing
      should_steal = (
        existing.column > col
        or (existing.type == STASH and commit.type != STASH
            and reservation and reservation.newest_date > existing.newest_date)
      )
      if should_steal and parent_sha not in has_merge_node_child_by_sha:
        reserver_info_by_sha[parent_sha] = Reservation(
          type=commit.type,
          newest_date=reservation.newest_date if reservation else None,
          column=col,
        )
        columns_to_free_when_found.setdefault(parent_sha, []).append(existing.column)
      else:
        columns_to_free_when_found.setdefault(parent_sha, []).append(col)
    elif existing is None or existing.column is None:
      # No reservation yet: first parent inherits current column;
      # extra parents get a new leftmost-free column.
      parent_is_pinned = parent_sha in pinned_branch_shas
      if parent_is_pinned:
        parent_col = 0
      elif i == 0:
        parent_col = col
      else:
        parent_col = alloc_column(columns_used, trunk_pin_active)
      reserver_info_by_sha[parent_sha] = Reservation(
        type=commit.type,
        newest_date=(reservation.newest_date if reservation else None),
        column=parent_col,
      )

  return col
```

## Chajá implications

Our current `LaneAssigner` (`crates/graph-core/src/lane.rs`) is leftmost-free
+ reuse (`claim_free_or_append`), which covers the basic allocation. To match
GitKraken we need to add:

1. A `pinned_branch_shas: HashSet<String>` input to the assigner, precomputed
   by the caller from the pinned branch (or HEAD as fallback).
2. A `reserver_info_by_sha` map tracked across commits.
3. A `columns_to_free_when_found` deferred-release map.
4. The stealing branch in `place_parents`.

All four live inside the lane assigner — they don't leak into the renderer.

## Source locations

Bundle: `/tmp/gk-asar/src/render/static/entryPoints/main/render.bundle.js`

Key symbols (minified names as found):
- `eg` — `allocColumn`.
- `getColumns` — per-commit entry point.
- `loadRowsbySha` — the topo-order walk orchestrator.
- `pinnedBranchShas` — the precomputed set.
- `hasMergeNodeChildBySha` — the stealing guard.
