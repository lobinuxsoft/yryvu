# Topological order

GitKraken does not implement its own topological sort. It delegates to git.

## Command used

```
git log --topo-order --date-order --first-parent --format=%H ...
```

- `--topo-order`: guarantees children are emitted before any of their
  ancestors, regardless of commit timestamps.
- `--date-order`: tie-breaks between multiple "ready" commits (commits whose
  in-degree has dropped to zero at the same step) by committer-date descending.
- `--first-parent`: relevant primarily when precomputing the pinned branch's
  spine — ensures the first-parent chain is preserved.

Arguments are gathered in a builder:

```python
args = []
if opts.topo_order: args.append("--topo-order")
if opts.date_order: args.append("--date-order")
if opts.first_parent: args.append("--first-parent")
# ...
git.log(*args, format="%H")
```

The rows returned from git are assumed to already be in children-before-parents
order. The lane assigner walks them in that order without any additional
validation.

## Why this matters

The lane assigner's invariants rely on "children before parents":

- When a commit is processed, its reservation (if any, made by an earlier
  child) is honored.
- When a commit with no existing reservation appears, it means no child
  has claimed it yet — so it's a tip on a new lane.

If a parent appears before any of its children, the child's later reservation
has nowhere to attach, and the parent ends up on a random leftmost-free lane.
This is the exact bug we hit when `gix`'s `Sorting::ByCommitTime(NewestFirst)`
produced out-of-order tips in repos with tied timestamps (see `yryvu-testbed`).

## Yryvu implementation

We don't shell out to `git` — `gix` is the primary backend. Our equivalent is
`topo_sort_children_first` in `crates/yryvu-bridge/src/repo/commits.rs`:

- Collect commits from gix's `ByCommitTime` walk into a `HashMap<sha, Commit>`.
- Build in-degree map: `in_deg[sha] = count of commits in set that list sha as parent`.
- Kahn's algorithm with a max-heap keyed by `(committer_time, sha)`:
  - Initialize heap with commits where `in_deg == 0` (ref tips / leaves).
  - Pop from heap, emit, decrement `in_deg` of parents; push parents that
    reach zero.
- Output order: children-before-parents, with committer-time desc as
  tiebreaker — equivalent to `--topo-order --date-order`.

We don't have a `--first-parent` equivalent yet; not needed until we
implement trunk pinning (see `05-trunk-pinning.md`), at which point we'll
walk first parents explicitly.

## Source locations

Bundle: same file.

- `dateOrder:true, firstParent:true, topoOrder:true` — option flags to the
  git log command builder (visible via grep for `topoOrder`).

Yryvu:
- `crates/yryvu-bridge/src/repo/commits.rs::topo_sort_children_first`
- `crates/yryvu-bridge/src/repo/commits.rs::TopoEntry` (heap entry with
  date-desc comparator).
