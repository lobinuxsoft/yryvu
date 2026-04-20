// SPDX-License-Identifier: AGPL-3.0-or-later

use thiserror::Error;

use crate::row::{Commit, GraphRow};

#[derive(Debug, Error)]
pub enum LaneError {
    #[error("palette size must be non-zero")]
    EmptyPalette,
}

#[derive(Debug, Clone)]
struct Slot {
    expecting: String,
}

/// Stateful lane assigner. Call [`LaneAssigner::assign`] once per commit in reverse
/// topological order (children before parents).
pub struct LaneAssigner {
    slots: Vec<Option<Slot>>,
    palette_size: u16,
}

impl LaneAssigner {
    pub fn new(palette_size: u16) -> Result<Self, LaneError> {
        if palette_size == 0 {
            return Err(LaneError::EmptyPalette);
        }
        Ok(Self {
            slots: Vec::with_capacity(16),
            palette_size,
        })
    }

    /// Current number of live lanes (free slots included up to the rightmost occupied one).
    pub fn lane_count(&self) -> usize {
        self.slots.len()
    }

    pub fn assign(&mut self, commit: Commit) -> GraphRow {
        let lane = self.claim_lane_for(&commit.sha);
        let color_idx = (lane as u16) % self.palette_size;

        let is_merge = commit.parents.len() > 1;
        let parent_lanes = self.place_parents(lane, &commit.parents);

        self.compact_tail();

        let short_sha = commit.sha.chars().take(7).collect();
        GraphRow {
            sha: commit.sha,
            short_sha,
            summary: commit.summary,
            author: commit.author,
            author_date: commit.author_date,
            lane: lane as u16,
            parent_lanes,
            parent_shas: commit.parents,
            color_idx,
            refs: commit.refs,
            is_merge,
        }
    }

    fn claim_lane_for(&mut self, sha: &str) -> usize {
        if let Some(idx) = self.find_lane_expecting(sha) {
            return idx;
        }
        self.claim_free_or_append(sha.to_string())
    }

    fn find_lane_expecting(&self, sha: &str) -> Option<usize> {
        self.slots
            .iter()
            .position(|s| s.as_ref().is_some_and(|slot| slot.expecting == sha))
    }

    fn claim_free_or_append(&mut self, expecting: String) -> usize {
        if let Some(idx) = self.slots.iter().position(Option::is_none) {
            self.slots[idx] = Some(Slot { expecting });
            idx
        } else {
            self.slots.push(Some(Slot { expecting }));
            self.slots.len() - 1
        }
    }

    fn place_parents(&mut self, current_lane: usize, parents: &[String]) -> Vec<u16> {
        if parents.is_empty() {
            self.slots[current_lane] = None;
            return Vec::new();
        }

        let mut lanes = Vec::with_capacity(parents.len());

        let first = &parents[0];
        match self.find_lane_expecting(first) {
            Some(existing) if existing != current_lane => {
                // Merge-back: our lane ends here, first parent lives in the pre-existing lane.
                self.slots[current_lane] = None;
                lanes.push(existing as u16);
            }
            _ => {
                self.slots[current_lane] = Some(Slot {
                    expecting: first.clone(),
                });
                lanes.push(current_lane as u16);
            }
        }

        for parent in &parents[1..] {
            let lane = if let Some(idx) = self.find_lane_expecting(parent) {
                idx
            } else {
                self.claim_free_or_append(parent.clone())
            };
            lanes.push(lane as u16);
        }

        lanes
    }

    fn compact_tail(&mut self) {
        while let Some(None) = self.slots.last() {
            self.slots.pop();
        }
    }
}
