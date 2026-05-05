// SPDX-License-Identifier: AGPL-3.0-or-later

use graph_core::Commit;

pub fn commit(sha: &str, parents: &[&str]) -> Commit {
    Commit {
        sha: sha.to_string(),
        parents: parents.iter().map(|s| s.to_string()).collect(),
        summary: format!("commit {sha}"),
        author_name: "test".to_string(),
        author_email: "t@t".to_string(),
        author_date: 0,
        ..Default::default()
    }
}
