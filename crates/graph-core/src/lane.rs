// SPDX-License-Identifier: AGPL-3.0-or-later

use std::collections::{HashMap, HashSet};

use thiserror::Error;

use crate::row::{Commit, GraphRow};

#[derive(Debug, Error)]
pub enum LaneError {
    #[error("palette size must be non-zero")]
    EmptyPalette,
}

/// Streaming lane allocator modelled after GitKraken's column algorithm.
///
/// Maintains four pieces of state across a topologically-ordered walk
/// (children before parents):
///
/// - `columns_used`   — bitmap of columns currently carrying an active edge.
/// - `reservations`   — sha → column, the column each parent is expected at.
/// - `pending_frees`  — sha → columns to release when we reach that sha.
/// - `merge_children` — shas that already have a merge child claiming them,
///   which blocks future stealing attempts.
///
/// A commit in `pinned_shas` is forced to column 0, giving the trunk a stable
/// vertical spine.
pub struct LaneAssigner {
    columns_used: Vec<bool>,
    reservations: HashMap<String, usize>,
    pending_frees: HashMap<String, Vec<usize>>,
    pinned_shas: HashSet<String>,
    /// Ref-tip shas — each commit that carries any ref (branch / remote / tag /
    /// HEAD) is in this set. When such a commit is reached AND already has an
    /// inherited reservation from a prior child, the reservation is discarded
    /// and a fresh lane is allocated instead. Matches GitKraken's observed
    /// behaviour of assigning each branch its own column end-to-end.
    ref_tip_shas: HashSet<String>,
    merge_children: HashSet<String>,
    /// Monotonically-increasing lane counter. Allocations never reuse a lane
    /// once it's been issued, even after the lane is freed — GitKraken retires
    /// empty columns rather than reclaiming them, producing the "branches
    /// don't swap columns" visual that's core to its graph identity.
    next_fresh_lane: usize,
}

impl LaneAssigner {
    pub fn new() -> Self {
        Self::with_config(HashSet::new(), HashSet::new())
    }

    /// Back-compat constructor — keeps existing call sites working without a
    /// ref-tip set (treating every commit as non-ref-tip).
    pub fn with_pinned(pinned_shas: HashSet<String>) -> Self {
        Self::with_config(pinned_shas, HashSet::new())
    }

    pub fn with_config(
        pinned_shas: HashSet<String>,
        ref_tip_shas: HashSet<String>,
    ) -> Self {
        Self {
            columns_used: Vec::with_capacity(16),
            reservations: HashMap::new(),
            pending_frees: HashMap::new(),
            pinned_shas,
            ref_tip_shas,
            merge_children: HashSet::new(),
            next_fresh_lane: 0,
        }
    }

    /// Number of live lanes (free slots included up to the rightmost occupied one).
    pub fn lane_count(&self) -> usize {
        self.columns_used.len()
    }

    /// Lane indices currently carrying an active edge.
    ///
    /// Returned sorted ascending. Used by [`layout_commits`] to snapshot
    /// `columns_used` before and after each [`place`] call — the union of the
    /// two snapshots plus the commit's own lane is the set of lanes with a
    /// vertical segment through the row (see [`crate::GraphRow::active_lanes`]).
    ///
    /// [`place`]: Self::place
    pub fn active_lane_indices(&self) -> Vec<u16> {
        self.columns_used
            .iter()
            .enumerate()
            .filter_map(|(i, &used)| if used { Some(i as u16) } else { None })
            .collect()
    }

    fn trunk_pin_active(&self) -> bool {
        !self.pinned_shas.is_empty()
    }

    /// Assign a column to `commit` and update parent reservations.
    ///
    /// Returns the column this commit occupies. Parent lanes are NOT derivable
    /// from this call alone — later commits may steal parent reservations to
    /// a leftward column, so parent_lanes must be resolved via a second pass
    /// over a sha → lane map (see [`layout_commits`]).
    pub fn place(&mut self, commit: &Commit) -> u16 {
        // 1. Release deferred columns queued to fire at this sha.
        if let Some(cols) = self.pending_frees.remove(&commit.sha) {
            for c in cols {
                if let Some(slot) = self.columns_used.get_mut(c) {
                    *slot = false;
                }
            }
        }

        // 2. Pick the column for this commit.
        let lane = self.pick_column(&commit.sha);

        // 3. Reserve columns for parents (with stealing).
        self.place_parents(lane, commit);

        // 4. If the commit is a leaf (parent-less), release its column.
        if commit.parents.is_empty() {
            self.columns_used[lane] = false;
        }

        self.compact_tail();
        lane as u16
    }

    fn pick_column(&mut self, sha: &str) -> usize {
        if self.pinned_shas.contains(sha) {
            self.ensure_column(0);
            self.columns_used[0] = true;
            self.reservations.remove(sha);
            return 0;
        }

        // Ref-tip override: if this commit carries a ref AND has inherited a
        // reservation from a prior child's parent slot, drop the reservation,
        // retire that lane, and hand out a fresh one. This is what produces
        // GitKraken's "each branch owns its own column" layout — without the
        // override a chain of ref tips (e.g. `disposable-1 → disposable-2 →
        // disposable-3`) all inherit the same column from the first tip.
        if self.ref_tip_shas.contains(sha) {
            if let Some(old_col) = self.reservations.remove(sha) {
                if let Some(slot) = self.columns_used.get_mut(old_col) {
                    *slot = false;
                }
            }
            return self.alloc_column();
        }

        if let Some(col) = self.reservations.remove(sha) {
            self.ensure_column(col);
            self.columns_used[col] = true;
            return col;
        }

        self.alloc_column()
    }

    fn alloc_column(&mut self) -> usize {
        // Never-reuse allocator: always hand out a fresh (monotonically
        // increasing) lane index. Previously-freed lanes stay retired — this
        // matches GitKraken's observed behaviour where branches don't swap
        // columns even after a chain terminates.
        let start = if self.trunk_pin_active() { 1 } else { 0 };
        let idx = self.next_fresh_lane.max(start);
        self.next_fresh_lane = idx + 1;
        self.ensure_column(idx);
        self.columns_used[idx] = true;
        idx
    }

    fn ensure_column(&mut self, idx: usize) {
        while self.columns_used.len() <= idx {
            self.columns_used.push(false);
        }
    }

    fn place_parents(&mut self, current_lane: usize, commit: &Commit) {
        if commit.parents.is_empty() {
            return;
        }

        let is_merge = commit.parents.len() > 1;
        if is_merge {
            for p in &commit.parents {
                self.merge_children.insert(p.clone());
            }
        }

        for (i, parent_sha) in commit.parents.iter().enumerate() {
            if self.pinned_shas.contains(parent_sha) {
                self.ensure_column(0);
                self.columns_used[0] = true;
                self.reservations.insert(parent_sha.clone(), 0);
                if i == 0 && current_lane != 0 {
                    // Defer freeing the child's lane until the pinned
                    // parent row is reached — otherwise the pass-through
                    // vertical in the child's column is invisible across
                    // the intermediate rows, which breaks the per-row SVG
                    // renderer's continuous-pipe assumption.
                    self.pending_frees
                        .entry(parent_sha.to_string())
                        .or_default()
                        .push(current_lane);
                }
                continue;
            }

            if i == 0 {
                self.place_first_parent(current_lane, parent_sha);
            } else {
                self.place_extra_parent(parent_sha);
            }
        }
    }

    fn place_first_parent(&mut self, current_lane: usize, parent_sha: &str) {
        let existing = self.reservations.get(parent_sha).copied();

        match existing {
            Some(existing_col) if existing_col < current_lane => {
                // Parent already lives in an older (leftward) lane — merge back.
                // Our column ends here; parent continues at the existing column.
                self.columns_used[current_lane] = false;
            }
            Some(existing_col) if existing_col > current_lane => {
                // Parent's reservation is rightward. Try to steal it leftward.
                let parent_has_merge_child = self.merge_children.contains(parent_sha);
                if parent_has_merge_child {
                    // Can't steal: a merge child already owns the parent at existing_col.
                    // Our column continues as a phantom until the parent arrives,
                    // then it's released via pending_frees.
                    self.pending_frees
                        .entry(parent_sha.to_string())
                        .or_default()
                        .push(current_lane);
                } else {
                    // Steal: move parent's reservation to our (leftward) column,
                    // queue existing_col for release when the parent is reached.
                    self.reservations
                        .insert(parent_sha.to_string(), current_lane);
                    self.pending_frees
                        .entry(parent_sha.to_string())
                        .or_default()
                        .push(existing_col);
                }
            }
            _ => {
                // No existing reservation, or it coincides with current_lane.
                // First-parent naturally continues our column.
                self.reservations
                    .insert(parent_sha.to_string(), current_lane);
            }
        }
    }

    fn place_extra_parent(&mut self, parent_sha: &str) {
        if self.reservations.contains_key(parent_sha) {
            return;
        }
        let col = self.alloc_column();
        self.reservations.insert(parent_sha.to_string(), col);
    }

    fn compact_tail(&mut self) {
        while let Some(false) = self.columns_used.last() {
            self.columns_used.pop();
        }
    }
}

impl Default for LaneAssigner {
    fn default() -> Self {
        Self::new()
    }
}

/// Layout a topologically-ordered commit slice into rendered rows.
///
/// Runs three passes:
///
/// 1. [`LaneAssigner`] streaming algorithm resolves each commit's final column,
///    snapshotting `columns_used` before and after each `place()` call to build
///    the per-row `active_lanes` set (lanes crossing the row, required by the
///    per-row edge renderer from issue #81).
/// 2. `parent_lanes` is filled in using the finalized sha → lane map — stealing
///    can change a parent's column *after* its child was assigned, so this
///    pass can't be folded into the first.
/// 3. [`crate::populate_child_refs`] propagates ref names bottom-up through
///    the topology so hover-dim (issue #54) can evaluate membership in O(1)
///    without walking the DAG on every hover event.
pub fn layout_commits(
    commits: Vec<Commit>,
    palette_size: u16,
    pinned_shas: HashSet<String>,
    ref_tip_shas: HashSet<String>,
) -> Result<Vec<GraphRow>, LaneError> {
    if palette_size == 0 {
        return Err(LaneError::EmptyPalette);
    }

    let mut assigner = LaneAssigner::with_config(pinned_shas, ref_tip_shas);
    let mut commits_lanes_actives: Vec<(Commit, u16, Vec<u16>)> =
        Vec::with_capacity(commits.len());
    let mut sha_to_lane: HashMap<String, u16> = HashMap::with_capacity(commits.len());

    for commit in commits {
        let before = assigner.active_lane_indices();
        let lane = assigner.place(&commit);
        let after = assigner.active_lane_indices();

        // Union before ∪ after ∪ {lane}, sorted ascending, deduplicated.
        let mut active: Vec<u16> = before;
        active.extend(after);
        active.push(lane);
        active.sort_unstable();
        active.dedup();

        sha_to_lane.insert(commit.sha.clone(), lane);
        commits_lanes_actives.push((commit, lane, active));
    }

    let mut rows: Vec<GraphRow> = commits_lanes_actives
        .into_iter()
        .map(|(commit, lane, active_lanes)| {
            let parent_lanes: Vec<u16> = commit
                .parents
                .iter()
                .map(|p| sha_to_lane.get(p).copied().unwrap_or(lane))
                .collect();
            let is_merge = commit.parents.len() > 1;
            let color_idx = lane % palette_size;
            let short_sha = commit.sha.chars().take(7).collect();
            GraphRow {
                sha: commit.sha,
                short_sha,
                summary: commit.summary,
                author: commit.author,
                author_date: commit.author_date,
                lane,
                parent_lanes,
                parent_shas: commit.parents,
                color_idx,
                refs: commit.refs,
                is_merge,
                child_refs: crate::ChildRefs::default(),
                active_lanes,
            }
        })
        .collect();

    crate::populate_child_refs(&mut rows);
    Ok(rows)
}
