// SPDX-License-Identifier: AGPL-3.0-or-later

use std::path::Path;

use anyhow::{anyhow, Context};
use gix::bstr::ByteSlice;

use crate::backend::{BackendError, TagInfo};

use super::common::{git2_err, open_git2, open_repo, validate_tag_name};

/// List every tag under `refs/tags/`, distinguishing lightweight from
/// annotated and surfacing the annotated tagger metadata + message.
///
/// `target_sha` is always the *peeled* commit SHA so callers can look up
/// the underlying commit without re-peeling. For annotated tags we also
/// decode the wrapping tag object to extract the message and tagger.
///
/// Sorted alphabetically by short name to match the GK sidebar order.
pub fn list_tags(repo_path: &Path) -> Result<Vec<TagInfo>, BackendError> {
    let repo = open_repo(repo_path)?;
    let platform = repo
        .references()
        .context("open references platform")
        .map_err(BackendError::Git)?;

    let mut out = Vec::new();
    for reference in platform
        .tags()
        .context("iterate tags")
        .map_err(BackendError::Git)?
    {
        let mut reference =
            reference.map_err(|e| BackendError::Git(anyhow!("resolve tag ref: {e}")))?;
        let full_name = reference.name().as_bstr().to_string();
        let short = reference.name().shorten().to_string();

        let direct_oid = reference.target().try_id().map(|id| id.to_owned());
        let peeled = reference
            .peel_to_id_in_place()
            .context("peel tag tip")
            .map_err(BackendError::Git)?
            .detach();

        let is_annotated = direct_oid.as_ref().is_some_and(|oid| *oid != peeled);

        let mut message = None;
        let mut tagger_name = None;
        let mut tagger_email = None;
        let mut tagger_date = None;

        if is_annotated {
            if let Some(oid) = direct_oid {
                if let Ok(obj) = repo.find_object(oid) {
                    if let Ok(tag) = obj.try_into_tag() {
                        if let Ok(decoded) = tag.decode() {
                            let msg = decoded.message.trim().as_bstr().to_string();
                            if !msg.is_empty() {
                                message = Some(msg);
                            }
                            if let Some(tagger) = decoded.tagger {
                                tagger_name = Some(tagger.name.to_string());
                                tagger_email = Some(tagger.email.to_string());
                                tagger_date = Some(tagger.time.seconds);
                            }
                        }
                    }
                }
            }
        }

        out.push(TagInfo {
            name: short,
            full_name,
            target_sha: peeled.to_string(),
            is_annotated,
            message,
            tagger_name,
            tagger_email,
            tagger_date,
        });
    }

    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Create a tag pointing at `sha`.
///
/// - `message = None` creates a lightweight tag (plain ref under `refs/tags/`).
/// - `message = Some(..)` creates a proper annotated tag object signed by the
///   configured `user.name` / `user.email`.
pub fn create_tag(
    repo_path: &Path,
    name: &str,
    sha: &str,
    message: Option<&str>,
) -> Result<(), BackendError> {
    validate_tag_name(name)?;
    let repo = open_git2(repo_path)?;

    let oid = git2::Oid::from_str(sha).map_err(|_| BackendError::CommitNotFound {
        sha: sha.to_string(),
    })?;
    let target = repo
        .find_object(oid, None)
        .map_err(|_| BackendError::CommitNotFound {
            sha: sha.to_string(),
        })?;

    let full_ref = format!("refs/tags/{name}");
    if repo.find_reference(&full_ref).is_ok() {
        return Err(BackendError::TagExists {
            name: name.to_string(),
        });
    }

    match message {
        Some(msg) => {
            let sig = repo.signature().map_err(git2_err)?;
            repo.tag(name, &target, &sig, msg, false)
                .map_err(git2_err)?;
        }
        None => {
            repo.tag_lightweight(name, &target, false)
                .map_err(git2_err)?;
        }
    }

    Ok(())
}
