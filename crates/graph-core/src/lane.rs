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
    merge_children: HashSet<String>,
}

impl LaneAssigner {
    pub fn new() -> Self {
        Self::with_pinned(HashSet::new())
    }

    pub fn with_pinned(pinned_shas: HashSet<String>) -> Self {
        Self {
            columns_used: Vec::with_capacity(16),
            reservations: HashMap::new(),
            pending_frees: HashMap::new(),
            pinned_shas,
            merge_children: HashSet::new(),
        }
    }

    /// Number of live lanes (free slots included up to the rightmost occupied one).
    pub fn lane_count(&self) -> usize {
        self.columns_used.len()
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

        if let Some(col) = self.reservations.remove(sha) {
            self.ensure_column(col);
            self.columns_used[col] = true;
            return col;
        }

        self.alloc_column()
    }

    fn alloc_column(&mut self) -> usize {
        let start = if self.trunk_pin_active() { 1 } else { 0 };
        for (idx, used) in self.columns_used.iter_mut().enumerate().skip(start) {
            if !*used {
                *used = true;
                return idx;
            }
        }
        while self.columns_used.len() < start {
            self.columns_used.push(false);
        }
        self.columns_used.push(true);
        self.columns_used.len() - 1
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
                    self.columns_used[current_lane] = false;
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
/// Runs two passes: the first runs the [`LaneAssigner`] streaming algorithm
/// to resolve each commit's final column, and the second fills in
/// `parent_lanes` using the finalized sha → lane map. Two passes are needed
/// because column stealing can change a parent's column *after* its child
/// has already been assigned.
pub fn layout_commits(
    commits: Vec<Commit>,
    palette_size: u16,
    pinned_shas: HashSet<String>,
) -> Result<Vec<GraphRow>, LaneError> {
    if palette_size == 0 {
        return Err(LaneError::EmptyPalette);
    }

    let mut assigner = LaneAssigner::with_pinned(pinned_shas);
    let mut commits_and_lanes: Vec<(Commit, u16)> = Vec::with_capacity(commits.len());
    let mut sha_to_lane: HashMap<String, u16> = HashMap::with_capacity(commits.len());

    for commit in commits {
        let lane = assigner.place(&commit);
        sha_to_lane.insert(commit.sha.clone(), lane);
        commits_and_lanes.push((commit, lane));
    }

    Ok(commits_and_lanes
        .into_iter()
        .map(|(commit, lane)| {
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
            }
        })
        .collect())
}
