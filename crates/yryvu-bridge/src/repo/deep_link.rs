// SPDX-License-Identifier: AGPL-3.0-or-later

//! `yryvu://repolink/<rootSha>[/<type>/<name>]?url=<remote>` — the contract of
//! GitKraken's `gitkraken://repolink` link. A repo is identified by its
//! remote URL plus root commit, never by a local path.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use url::Url;

use super::common::{git2_err, open_git2};
use crate::backend::BackendError;

const SCHEME: &str = "yryvu";
const HOST: &str = "repolink";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(tag = "kind", content = "name", rename_all = "camelCase")]
pub enum LinkTarget {
    Remote,
    Branch(String),
    Commit(String),
    Tag(String),
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RepoLink {
    pub first_sha: String,
    pub url: String,
    pub target: LinkTarget,
}

/// Parse a deep link. The error is user-facing.
pub fn parse_link(raw: &str) -> Result<RepoLink, String> {
    let bad = || format!("Invalid link: {raw}");
    let uri = Url::parse(raw).map_err(|_| bad())?;
    if uri.scheme() != SCHEME || !uri.host_str().is_some_and(|h| h.eq_ignore_ascii_case(HOST)) {
        return Err(bad());
    }
    let mut parts = uri.path_segments().ok_or_else(bad)?;
    let first_sha = parts.next().filter(|s| !s.is_empty()).ok_or_else(bad)?;
    let url = uri
        .query_pairs()
        .find_map(|(k, v)| (k == "url").then(|| v.into_owned()))
        .filter(|u| !u.is_empty())
        .ok_or_else(bad)?;
    let target = match (parts.next(), parts.next()) {
        (None, _) => LinkTarget::Remote,
        (Some(kind), Some(name)) if !name.is_empty() => {
            let name = decode(name);
            match kind {
                "branch" => LinkTarget::Branch(name),
                "commit" => LinkTarget::Commit(name),
                "tag" => LinkTarget::Tag(name),
                _ => return Err(bad()),
            }
        }
        _ => return Err(bad()),
    };
    Ok(RepoLink {
        first_sha: decode(first_sha),
        url,
        target,
    })
}

pub fn format_link(link: &RepoLink) -> String {
    let (kind, name) = match &link.target {
        LinkTarget::Remote => ("", ""),
        LinkTarget::Branch(n) => ("branch", n.as_str()),
        LinkTarget::Commit(n) => ("commit", n.as_str()),
        LinkTarget::Tag(n) => ("tag", n.as_str()),
    };
    let mut out = Url::parse(&format!("{SCHEME}://{HOST}/")).expect("static url");
    {
        let mut segs = out.path_segments_mut().expect("hierarchical url");
        segs.push(&link.first_sha);
        if !kind.is_empty() {
            segs.push(kind).push(name);
        }
    }
    out.query_pairs_mut().append_pair("url", &link.url);
    out.into()
}

/// Host + path, lowercase, without credentials, port or `.git`, so that
/// `https://`, `ssh://` and scp-style URLs of one repo compare equal.
pub fn normalize_remote(raw: &str) -> String {
    let raw = raw.trim();
    let (host, path) = if let Ok(u) = Url::parse(raw) {
        (u.host_str().unwrap_or("").to_string(), u.path().to_string())
    } else if let Some((left, path)) = raw.split_once(':') {
        let host = left.rsplit_once('@').map_or(left, |(_, h)| h);
        (host.to_string(), path.to_string())
    } else {
        return raw.to_lowercase();
    };
    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);
    format!("{host}/{path}").to_lowercase()
}

/// Same URL with its password removed — links get pasted into chats.
fn strip_password(raw: &str) -> String {
    match Url::parse(raw) {
        Ok(mut u) if u.password().is_some() => {
            let _ = u.set_password(None);
            u.into()
        }
        _ => raw.to_string(),
    }
}

fn decode(s: &str) -> String {
    percent_encoding::percent_decode_str(s)
        .decode_utf8_lossy()
        .into_owned()
}

/// Oldest parentless commit reachable from HEAD.
fn root_commit(repo: &git2::Repository) -> Result<String, BackendError> {
    let mut walk = repo.revwalk().map_err(git2_err)?;
    walk.push_head().map_err(git2_err)?;
    walk.set_sorting(git2::Sort::TIME | git2::Sort::REVERSE)
        .map_err(git2_err)?;
    for oid in walk {
        let oid = oid.map_err(git2_err)?;
        if repo.find_commit(oid).map_err(git2_err)?.parent_count() == 0 {
            return Ok(oid.to_string());
        }
    }
    Err(BackendError::CommitNotFound {
        sha: "root".to_string(),
    })
}

/// Link for `target` in the repo at `repo_path`, via `origin` or the first
/// remote with a URL.
pub fn build_link(repo_path: &Path, target: LinkTarget) -> Result<String, BackendError> {
    let repo = open_git2(repo_path)?;
    let names = repo.remotes().map_err(git2_err)?;
    let url = names
        .iter()
        .flatten()
        .filter_map(|n| repo.find_remote(n).ok())
        .filter_map(|r| Some((r.name()? == "origin", r.url()?.to_string())))
        .max_by_key(|(origin, _)| *origin)
        .map(|(_, u)| strip_password(&u))
        .ok_or_else(|| BackendError::RemoteNotFound {
            name: "origin".to_string(),
        })?;
    Ok(format_link(&RepoLink {
        first_sha: root_commit(&repo)?,
        url,
        target,
    }))
}

/// Candidates holding a remote equal to `link.url` and a root commit
/// `link.first_sha`.
pub fn resolve_link(candidates: &[PathBuf], link: &RepoLink) -> Vec<PathBuf> {
    let want = normalize_remote(&link.url);
    let Ok(root) = git2::Oid::from_str(&link.first_sha) else {
        return Vec::new();
    };
    candidates
        .iter()
        .filter(|path| {
            let Ok(repo) = git2::Repository::open(path) else {
                return false;
            };
            let has_remote = repo.remotes().is_ok_and(|names| {
                names
                    .iter()
                    .flatten()
                    .filter_map(|n| repo.find_remote(n).ok())
                    .any(|r| r.url().is_some_and(|u| normalize_remote(u) == want))
            });
            has_remote && repo.find_commit(root).is_ok_and(|c| c.parent_count() == 0)
        })
        .cloned()
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(target: LinkTarget) -> RepoLink {
        RepoLink {
            first_sha: "a1b2c3".into(),
            url: "https://github.com/o/r.git".into(),
            target,
        }
    }

    #[test]
    fn links_round_trip() {
        for t in [
            LinkTarget::Remote,
            LinkTarget::Branch("feat/a b".into()),
            LinkTarget::Commit("deadbeef".into()),
            LinkTarget::Tag("v1.0+rc".into()),
        ] {
            let l = link(t);
            assert_eq!(parse_link(&format_link(&l)).unwrap(), l);
        }
    }

    #[test]
    fn bad_links_are_rejected() {
        for raw in [
            "gitkraken://repolink/a1?url=x",
            "yryvu://other/a1?url=x",
            "yryvu://repolink/a1/blob/x?url=x",
            "yryvu://repolink/a1/branch?url=x",
            "yryvu://repolink/a1/branch/x",
            "not a url",
        ] {
            assert!(parse_link(raw).is_err(), "{raw}");
        }
    }

    #[test]
    fn remote_forms_match() {
        let want = normalize_remote("https://github.com/O/r.git");
        for u in [
            "git@github.com:o/r.git",
            "ssh://git@github.com:22/o/r",
            "https://user:pw@GitHub.com/o/r/",
        ] {
            assert_eq!(normalize_remote(u), want, "{u}");
        }
    }

    #[test]
    fn link_finds_its_repo() {
        let dir = tempfile::tempdir().unwrap();
        let repo = git2::Repository::init(dir.path()).unwrap();
        repo.remote("origin", "git@github.com:o/r.git").unwrap();
        let sig = git2::Signature::now("t", "t@t").unwrap();
        let tree = repo
            .find_tree(repo.index().unwrap().write_tree().unwrap())
            .unwrap();
        let root = repo
            .commit(Some("HEAD"), &sig, &sig, "root", &tree, &[])
            .unwrap();
        let built = build_link(dir.path(), LinkTarget::Branch("main".into())).unwrap();
        let parsed = parse_link(&built).unwrap();
        assert_eq!(parsed.first_sha, root.to_string());
        let other = tempfile::tempdir().unwrap();
        git2::Repository::init(other.path()).unwrap();
        let found = resolve_link(&[other.path().into(), dir.path().into()], &parsed);
        assert_eq!(found, vec![dir.path().to_path_buf()]);
    }
}
