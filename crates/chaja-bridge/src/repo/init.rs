// SPDX-License-Identifier: AGPL-3.0-or-later

//! Repository initialization. git2's `RepositoryInitOptions::initial_head`
//! provides a clean way to set the default branch on a fresh repo;
//! gix 0.68 lacks an ergonomic equivalent.
//!
//! BACKEND: git2 — revisit if gix grows `initial_head` support.

use std::ffi::OsString;
use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};

use chrono::Datelike;
use git2::{Repository, RepositoryInitOptions};

use crate::backend::BackendError;
use crate::repo::common::{git2_err, validate_branch_name};
use crate::templates::{render_license, TemplateEntry, ALL_GITIGNORE, ALL_LICENSE};

#[derive(Debug, Clone)]
pub struct InitOptions {
    pub branch_name: String,
    pub gitignore_template: Option<String>,
    pub license_template: Option<String>,
    pub initialize_first_commit: bool,
    pub bare: bool,
}

pub fn init_repository(path: &Path, opts: InitOptions) -> Result<PathBuf, BackendError> {
    validate_branch_name(&opts.branch_name)?;

    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() && !parent.is_dir() {
            return Err(BackendError::InitInvalidPath {
                path: path.display().to_string(),
                reason: "parent directory does not exist".into(),
            });
        }
    }

    if path.exists() && !path.is_dir() {
        return Err(BackendError::InitInvalidPath {
            path: path.display().to_string(),
            reason: "destination is not a directory".into(),
        });
    }

    if !path.exists() {
        fs::create_dir_all(path).map_err(|e| BackendError::InitWriteFailed {
            path: path.display().to_string(),
            source: anyhow::Error::new(e).context("create dest directory"),
        })?;
    }

    let mut init_opts = RepositoryInitOptions::new();
    init_opts.bare(opts.bare);
    init_opts.initial_head(&opts.branch_name);
    init_opts.no_reinit(true);

    let repo = Repository::init_opts(path, &init_opts).map_err(|e| {
        if e.code() == git2::ErrorCode::Exists {
            BackendError::InitDestExists {
                path: path.display().to_string(),
            }
        } else {
            git2_err(e)
        }
    })?;

    if !opts.bare {
        let staged = write_optional_files(path, &opts)?;
        if opts.initialize_first_commit {
            create_initial_commit(&repo, &staged)?;
        }
    }

    Ok(path.to_path_buf())
}

fn write_optional_files(
    path: &Path,
    opts: &InitOptions,
) -> Result<Vec<&'static str>, BackendError> {
    let mut staged = Vec::new();
    if let Some(name) = &opts.gitignore_template {
        let entry = TemplateEntry::lookup(ALL_GITIGNORE, name)
            .ok_or_else(|| BackendError::InitTemplateMissing { name: name.clone() })?;
        atomic_write(&path.join(".gitignore"), entry.content)?;
        staged.push(".gitignore");
    }
    if let Some(name) = &opts.license_template {
        let entry = TemplateEntry::lookup(ALL_LICENSE, name)
            .ok_or_else(|| BackendError::InitTemplateMissing { name: name.clone() })?;
        let author = git_user_name().unwrap_or_else(|| "Anonymous".to_string());
        let year = chrono::Utc::now().year();
        let rendered = render_license(entry.content, year, &author);
        atomic_write(&path.join("LICENSE"), &rendered)?;
        staged.push("LICENSE");
    }
    Ok(staged)
}

fn atomic_write(path: &Path, content: &str) -> Result<(), BackendError> {
    let tmp = temp_sibling(path);
    let result = (|| -> std::io::Result<()> {
        let mut f = File::create(&tmp)?;
        f.write_all(content.as_bytes())?;
        f.sync_all()?;
        fs::rename(&tmp, path)
    })();
    result.map_err(|e| BackendError::InitWriteFailed {
        path: path.display().to_string(),
        source: anyhow::Error::new(e).context("atomic write"),
    })
}

fn temp_sibling(path: &Path) -> PathBuf {
    let mut s: OsString = path.as_os_str().to_owned();
    s.push(".chaja-tmp");
    PathBuf::from(s)
}

fn create_initial_commit(repo: &Repository, files: &[&str]) -> Result<(), BackendError> {
    let mut index = repo.index().map_err(git2_err)?;
    for f in files {
        index.add_path(Path::new(f)).map_err(git2_err)?;
    }
    index.write().map_err(git2_err)?;
    let tree_id = index.write_tree().map_err(git2_err)?;
    let tree = repo.find_tree(tree_id).map_err(git2_err)?;

    let sig = repo
        .signature()
        .or_else(|_| git2::Signature::now("chaja", "chaja@local"))
        .map_err(git2_err)?;

    repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
        .map_err(git2_err)?;
    Ok(())
}

fn git_user_name() -> Option<String> {
    git2::Config::open_default()
        .ok()?
        .get_string("user.name")
        .ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn opts() -> InitOptions {
        InitOptions {
            branch_name: "main".into(),
            gitignore_template: None,
            license_template: None,
            initialize_first_commit: false,
            bare: false,
        }
    }

    fn open_repo(path: &Path) -> Repository {
        Repository::open(path).expect("open initialized repo")
    }

    #[test]
    fn init_non_bare_creates_git_dir_and_returns_path() {
        let tmp = TempDir::new().unwrap();
        let dest = tmp.path().join("repo");
        let result = init_repository(&dest, opts()).unwrap();
        assert_eq!(result, dest);
        assert!(dest.join(".git").is_dir());
    }

    #[test]
    fn init_bare_creates_git_dir_at_dest() {
        let tmp = TempDir::new().unwrap();
        let dest = tmp.path().join("bare.git");
        let mut o = opts();
        o.bare = true;
        init_repository(&dest, o).unwrap();
        assert!(dest.join("HEAD").is_file());
    }

    #[test]
    fn init_honours_initial_branch_name() {
        let tmp = TempDir::new().unwrap();
        let dest = tmp.path().join("repo");
        let mut o = opts();
        o.branch_name = "trunk".into();
        init_repository(&dest, o).unwrap();
        let head = std::fs::read_to_string(dest.join(".git/HEAD")).unwrap();
        assert!(head.contains("refs/heads/trunk"), "HEAD = {head}");
    }

    #[test]
    fn init_with_first_commit_off_leaves_no_commits() {
        let tmp = TempDir::new().unwrap();
        let dest = tmp.path().join("repo");
        init_repository(&dest, opts()).unwrap();
        let repo = open_repo(&dest);
        assert!(repo.head().is_err(), "expected unborn HEAD");
    }

    #[test]
    fn init_with_first_commit_on_creates_initial_commit() {
        let tmp = TempDir::new().unwrap();
        let dest = tmp.path().join("repo");
        let mut o = opts();
        o.initialize_first_commit = true;
        init_repository(&dest, o).unwrap();
        let repo = open_repo(&dest);
        let head = repo.head().expect("HEAD set");
        let commit = head.peel_to_commit().unwrap();
        assert_eq!(commit.message(), Some("Initial commit"));
        assert_eq!(commit.parent_count(), 0);
    }

    #[test]
    fn init_with_gitignore_template_writes_file() {
        let tmp = TempDir::new().unwrap();
        let dest = tmp.path().join("repo");
        let mut o = opts();
        o.gitignore_template = Some("rust".into());
        init_repository(&dest, o).unwrap();
        let body = std::fs::read_to_string(dest.join(".gitignore")).unwrap();
        assert!(
            body.contains("target"),
            "Rust .gitignore should mention 'target'"
        );
    }

    #[test]
    fn init_with_license_template_renders_placeholders() {
        let tmp = TempDir::new().unwrap();
        let dest = tmp.path().join("repo");
        let mut o = opts();
        o.license_template = Some("mit".into());
        init_repository(&dest, o).unwrap();
        let body = std::fs::read_to_string(dest.join("LICENSE")).unwrap();
        assert!(!body.contains("{{year}}"));
        assert!(!body.contains("{{author}}"));
        assert!(body.contains(&chrono::Utc::now().year().to_string()));
    }

    #[test]
    fn init_with_templates_and_first_commit_stages_them() {
        let tmp = TempDir::new().unwrap();
        let dest = tmp.path().join("repo");
        let mut o = opts();
        o.gitignore_template = Some("rust".into());
        o.license_template = Some("mit".into());
        o.initialize_first_commit = true;
        init_repository(&dest, o).unwrap();
        let repo = open_repo(&dest);
        let tree = repo.head().unwrap().peel_to_tree().unwrap();
        assert!(tree.get_name(".gitignore").is_some());
        assert!(tree.get_name("LICENSE").is_some());
    }

    #[test]
    fn init_rejects_existing_repo() {
        let tmp = TempDir::new().unwrap();
        let dest = tmp.path().join("repo");
        init_repository(&dest, opts()).unwrap();
        let err = init_repository(&dest, opts()).unwrap_err();
        assert!(
            matches!(err, BackendError::InitDestExists { .. }),
            "got {err:?}"
        );
    }

    #[test]
    fn init_rejects_invalid_branch_name() {
        let tmp = TempDir::new().unwrap();
        let dest = tmp.path().join("repo");
        let mut o = opts();
        o.branch_name = "has spaces".into();
        let err = init_repository(&dest, o).unwrap_err();
        assert!(
            matches!(err, BackendError::InvalidBranchName { .. }),
            "got {err:?}"
        );
    }

    #[test]
    fn init_rejects_unknown_template() {
        let tmp = TempDir::new().unwrap();
        let dest = tmp.path().join("repo");
        let mut o = opts();
        o.gitignore_template = Some("not-a-real-template".into());
        let err = init_repository(&dest, o).unwrap_err();
        assert!(
            matches!(err, BackendError::InitTemplateMissing { .. }),
            "got {err:?}"
        );
    }

    #[test]
    fn init_rejects_missing_parent() {
        let tmp = TempDir::new().unwrap();
        let dest = tmp.path().join("nonexistent").join("repo");
        let err = init_repository(&dest, opts()).unwrap_err();
        assert!(
            matches!(err, BackendError::InitInvalidPath { .. }),
            "got {err:?}"
        );
    }
}
