// SPDX-License-Identifier: AGPL-3.0-or-later

use criterion::{criterion_group, criterion_main, Criterion};
use graph_core::{Commit, LaneAssigner};

fn synth_linear(n: usize) -> Vec<Commit> {
    (0..n)
        .map(|i| Commit {
            sha: format!("{i:040x}"),
            parents: if i + 1 < n {
                vec![format!("{:040x}", i + 1)]
            } else {
                Vec::new()
            },
            summary: format!("c{i}"),
            author: "t".into(),
            author_date: i as i64,
            refs: Vec::new(),
        })
        .collect()
}

/// Alternating merge/branch pattern exercising fork-join lanes.
fn synth_braid(n: usize) -> Vec<Commit> {
    // Build n rows. Every 16th commit is a merge that reunites with an offset.
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let sha = format!("{i:040x}");
        let parents = match i {
            _ if i + 1 == n => Vec::new(),
            _ if i % 16 == 0 && i + 16 < n => {
                vec![format!("{:040x}", i + 1), format!("{:040x}", i + 17)]
            }
            _ => vec![format!("{:040x}", i + 1)],
        };
        out.push(Commit {
            sha,
            parents,
            summary: format!("c{i}"),
            author: "t".into(),
            author_date: i as i64,
            refs: Vec::new(),
        });
    }
    out
}

fn bench_lane(c: &mut Criterion) {
    for size in [1_000usize, 10_000, 50_000] {
        let linear = synth_linear(size);
        c.bench_function(&format!("linear/{size}"), |b| {
            b.iter(|| {
                let mut a = LaneAssigner::new(32).unwrap();
                for commit in &linear {
                    let _ = a.assign(commit.clone());
                }
            });
        });

        let braid = synth_braid(size);
        c.bench_function(&format!("braid/{size}"), |b| {
            b.iter(|| {
                let mut a = LaneAssigner::new(32).unwrap();
                for commit in &braid {
                    let _ = a.assign(commit.clone());
                }
            });
        });
    }
}

criterion_group!(benches, bench_lane);
criterion_main!(benches);
