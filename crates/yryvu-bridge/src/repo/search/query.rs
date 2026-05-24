// SPDX-License-Identifier: AGPL-3.0-or-later

//! Query side of the fuzzy palette. Uses `nucleo-matcher`'s low-level
//! `fuzzy_match` to score haystacks one by one — no allocations per
//! call beyond the two utf32 scratch buffers we re-use across the loop.

use std::path::Path;

use nucleo_matcher::{Config, Matcher, Utf32Str};
use serde::{Deserialize, Serialize};

use crate::backend::BackendError;

use super::index::SearchIndex;
use super::SearchMode;

const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 100;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct SearchHit {
    pub mode: SearchMode,
    pub idx: u32,
    pub score: u32,
    pub label: String,
    pub sublabel: String,
}

/// Run a fuzzy query in `mode` over the cached index. Empty `query`
/// returns the first `limit` rows ordered by recency.
pub fn search(
    repo_path: &Path,
    mode: SearchMode,
    query: &str,
    limit: Option<u32>,
) -> Result<Vec<SearchHit>, BackendError> {
    let limit = limit
        .map(|l| (l as usize).min(MAX_LIMIT))
        .unwrap_or(DEFAULT_LIMIT);
    super::cache_with(repo_path, |index| Ok(search_in(index, mode, query, limit)))
}

fn search_in(index: &SearchIndex, mode: SearchMode, query: &str, limit: usize) -> Vec<SearchHit> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return recents(index, mode, limit);
    }
    let mut matcher = Matcher::new(Config::DEFAULT);
    let mut needle_buf = Vec::new();
    let needle = Utf32Str::new(trimmed, &mut needle_buf);

    match mode {
        SearchMode::Commits => score_commits(index, &mut matcher, needle, limit),
        SearchMode::Files => score_files(index, &mut matcher, needle, limit),
        SearchMode::Branches => score_branches(index, &mut matcher, needle, limit),
        SearchMode::Tags => score_tags(index, &mut matcher, needle, limit),
        SearchMode::Stashes => score_stashes(index, &mut matcher, needle, limit),
    }
}

fn recents(index: &SearchIndex, mode: SearchMode, limit: usize) -> Vec<SearchHit> {
    let n = match mode {
        SearchMode::Commits => index.commits.oids.len(),
        SearchMode::Files => index.files.paths.len(),
        SearchMode::Branches => index.branches.names.len(),
        SearchMode::Tags => index.tags.names.len(),
        SearchMode::Stashes => index.stashes.messages.len(),
    };
    (0..n.min(limit))
        .map(|i| build_hit(index, mode, i as u32, 0))
        .collect()
}

/// Score every entry in `haystacks` and return the top `limit` by
/// score desc + tie-break by `recency` desc.
fn rank(
    matcher: &mut Matcher,
    needle: Utf32Str<'_>,
    haystacks: &[String],
    recency: impl Fn(usize) -> i64,
    limit: usize,
) -> Vec<(u32, u32)> {
    let mut scored: Vec<(u32, u32, i64)> = Vec::new();
    let mut hay_buf = Vec::new();
    for (i, s) in haystacks.iter().enumerate() {
        hay_buf.clear();
        let h = Utf32Str::new(s, &mut hay_buf);
        if let Some(score) = matcher.fuzzy_match(h, needle) {
            scored.push((i as u32, score as u32, recency(i)));
        }
    }
    scored.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| b.2.cmp(&a.2)));
    scored.truncate(limit);
    scored.into_iter().map(|(i, s, _)| (i, s)).collect()
}

fn score_commits(
    index: &SearchIndex,
    matcher: &mut Matcher,
    needle: Utf32Str<'_>,
    limit: usize,
) -> Vec<SearchHit> {
    let ts = &index.commits.timestamps;
    rank(
        matcher,
        needle,
        &index.commits.summaries,
        |i| ts.get(i).copied().unwrap_or(0),
        limit,
    )
    .into_iter()
    .map(|(i, s)| build_hit(index, SearchMode::Commits, i, s))
    .collect()
}

fn score_files(
    index: &SearchIndex,
    matcher: &mut Matcher,
    needle: Utf32Str<'_>,
    limit: usize,
) -> Vec<SearchHit> {
    rank(matcher, needle, &index.files.paths, |_| 0, limit)
        .into_iter()
        .map(|(i, s)| build_hit(index, SearchMode::Files, i, s))
        .collect()
}

fn score_branches(
    index: &SearchIndex,
    matcher: &mut Matcher,
    needle: Utf32Str<'_>,
    limit: usize,
) -> Vec<SearchHit> {
    rank(matcher, needle, &index.branches.names, |_| 0, limit)
        .into_iter()
        .map(|(i, s)| build_hit(index, SearchMode::Branches, i, s))
        .collect()
}

fn score_tags(
    index: &SearchIndex,
    matcher: &mut Matcher,
    needle: Utf32Str<'_>,
    limit: usize,
) -> Vec<SearchHit> {
    rank(matcher, needle, &index.tags.names, |_| 0, limit)
        .into_iter()
        .map(|(i, s)| build_hit(index, SearchMode::Tags, i, s))
        .collect()
}

fn score_stashes(
    index: &SearchIndex,
    matcher: &mut Matcher,
    needle: Utf32Str<'_>,
    limit: usize,
) -> Vec<SearchHit> {
    rank(matcher, needle, &index.stashes.messages, |_| 0, limit)
        .into_iter()
        .map(|(i, s)| build_hit(index, SearchMode::Stashes, i, s))
        .collect()
}

fn build_hit(index: &SearchIndex, mode: SearchMode, i: u32, score: u32) -> SearchHit {
    let n = i as usize;
    let (label, sublabel) = match mode {
        SearchMode::Commits => (
            index.commits.summaries.get(n).cloned().unwrap_or_default(),
            format!(
                "{} · {}",
                index.commits.short_oids.get(n).cloned().unwrap_or_default(),
                index.commits.authors.get(n).cloned().unwrap_or_default()
            ),
        ),
        SearchMode::Files => (
            index.files.paths.get(n).cloned().unwrap_or_default(),
            String::new(),
        ),
        SearchMode::Branches => {
            let sublabel = if *index.branches.is_remote.get(n).unwrap_or(&false) {
                "remote".to_string()
            } else {
                "local".to_string()
            };
            (
                index.branches.names.get(n).cloned().unwrap_or_default(),
                sublabel,
            )
        }
        SearchMode::Tags => (
            index.tags.names.get(n).cloned().unwrap_or_default(),
            index
                .tags
                .targets
                .get(n)
                .map(|s| s.chars().take(7).collect())
                .unwrap_or_default(),
        ),
        SearchMode::Stashes => (
            index.stashes.messages.get(n).cloned().unwrap_or_default(),
            format!(
                "stash@{{{}}}",
                index.stashes.stack_idx.get(n).copied().unwrap_or_default()
            ),
        ),
    };
    SearchHit {
        mode,
        idx: i,
        score,
        label,
        sublabel,
    }
}
