// SPDX-License-Identifier: AGPL-3.0-or-later

//! External tools preferences (issue #105). GitKraken's `ToolPreferences`
//! section bundles five sub-sections (Diff / Merge / External Editor /
//! External Terminal / Coding Agent); yryvu ships only **External
//! Terminal** — the workflow it enables ("give me a shell at this repo
//! root") is universally useful and decoupled from yryvu's own surfaces.
//! Diff / Merge / External Editor were dropped during scope review; open
//! a new issue per sub-section if either becomes needed. Coding Agent is
//! GK Pro proprietary.
//!
//! Validated against `app/src/strings/en-us.json` (`ToolPreferences-*`):
//! `ExternalTerminalSubHeader`, `CustomExternalTerminalPath`,
//! `CustomExternalTerminalCommand`, `ShowArguments`, `HideArguments`.
//!
//! The module owns both the persistence struct (`ToolPreferences`,
//! `ExternalTerminal`) and the launch-spec builder
//! (`build_terminal_spawn`). The builder is split out from any
//! `std::process::Command` call so it can be unit-tested without
//! depending on a graphical terminal being installed on the CI runner.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// `Preferences > Tools` panel state (issue #105). Currently a thin
/// wrapper around `ExternalTerminal` — kept as its own struct so future
/// sub-sections (if any are ever opened) slot in without breaking the
/// IPC contract.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolPreferences {
    #[serde(default)]
    pub external_terminal: ExternalTerminal,
}

/// External terminal launcher configuration. Both fields are `Option`
/// because "not configured yet" is the meaningful default — yryvu has no
/// way to guess the user's preferred terminal across Linux desktops,
/// macOS, and Windows, so the launcher returns
/// [`TerminalSpawnError::NotConfigured`] when `path` is empty rather
/// than picking one silently.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExternalTerminal {
    #[serde(default)]
    pub path: Option<String>,
    #[serde(default)]
    pub args: Option<String>,
}

/// Argv + cwd resolution of an external-terminal launch. Built by
/// [`build_terminal_spawn`] and consumed by the Tauri command that
/// actually performs the spawn. Keeping the spec separate from the
/// spawn means tests can assert exact argv composition without a real
/// terminal binary on `PATH`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalSpawnSpec {
    pub binary: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
}

#[derive(Debug, Error)]
pub enum TerminalSpawnError {
    #[error("external terminal path is not configured")]
    NotConfigured,
    #[error("repo path is not a directory: {0}")]
    InvalidCwd(String),
    #[error("argument template is not shell-parseable: {0}")]
    ArgsParse(String),
}

/// Build a spawn spec from the user's preferences plus the target repo
/// path. Substitutes the `{cwd}` placeholder in the argument template
/// with the absolute repo path so users can place it wherever their
/// terminal expects (e.g. `gnome-terminal --working-directory={cwd}`,
/// `wezterm start --cwd {cwd}`, etc.). If the template is empty the
/// command is spawned with `cwd` set on the child process so any
/// terminal that inherits its working directory ends up in the right
/// place automatically.
pub fn build_terminal_spawn(
    cfg: &ExternalTerminal,
    repo_path: &Path,
) -> Result<TerminalSpawnSpec, TerminalSpawnError> {
    let binary = cfg
        .path
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or(TerminalSpawnError::NotConfigured)?
        .to_string();
    if !repo_path.is_dir() {
        return Err(TerminalSpawnError::InvalidCwd(
            repo_path.display().to_string(),
        ));
    }
    let cwd = repo_path.to_path_buf();
    let cwd_str = repo_path.to_string_lossy();
    let template = cfg.args.as_deref().unwrap_or("").trim();
    let args = if template.is_empty() {
        Vec::new()
    } else {
        let substituted = template.replace("{cwd}", &cwd_str);
        shlex::split(&substituted).ok_or_else(|| TerminalSpawnError::ArgsParse(template.into()))?
    };
    Ok(TerminalSpawnSpec { binary, args, cwd })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn cfg(path: Option<&str>, args: Option<&str>) -> ExternalTerminal {
        ExternalTerminal {
            path: path.map(str::to_owned),
            args: args.map(str::to_owned),
        }
    }

    #[test]
    fn empty_path_is_not_configured() {
        let dir = TempDir::new().unwrap();
        let err = build_terminal_spawn(&cfg(None, None), dir.path()).unwrap_err();
        assert!(matches!(err, TerminalSpawnError::NotConfigured));

        let err = build_terminal_spawn(&cfg(Some(""), None), dir.path()).unwrap_err();
        assert!(matches!(err, TerminalSpawnError::NotConfigured));

        let err = build_terminal_spawn(&cfg(Some("   "), None), dir.path()).unwrap_err();
        assert!(matches!(err, TerminalSpawnError::NotConfigured));
    }

    #[test]
    fn invalid_cwd_rejected() {
        let err = build_terminal_spawn(
            &cfg(Some("/usr/bin/true"), None),
            Path::new("/does/not/exist"),
        )
        .unwrap_err();
        assert!(matches!(err, TerminalSpawnError::InvalidCwd(_)));
    }

    #[test]
    fn empty_args_spawns_with_cwd_only() {
        let dir = TempDir::new().unwrap();
        let spec = build_terminal_spawn(&cfg(Some("/usr/bin/kitty"), None), dir.path()).unwrap();
        assert_eq!(spec.binary, "/usr/bin/kitty");
        assert!(spec.args.is_empty());
        assert_eq!(spec.cwd, dir.path());
    }

    #[test]
    fn cwd_placeholder_substituted() {
        let dir = TempDir::new().unwrap();
        let spec = build_terminal_spawn(
            &cfg(
                Some("/usr/bin/gnome-terminal"),
                Some("--working-directory={cwd}"),
            ),
            dir.path(),
        )
        .unwrap();
        let expected_arg = format!("--working-directory={}", dir.path().display());
        assert_eq!(spec.args, vec![expected_arg]);
    }

    #[test]
    fn shell_quoted_args_split_correctly() {
        let dir = TempDir::new().unwrap();
        let spec = build_terminal_spawn(
            &cfg(
                Some("/usr/bin/wezterm"),
                Some("start --cwd \"{cwd}\" -- bash"),
            ),
            dir.path(),
        )
        .unwrap();
        let cwd_str = dir.path().display().to_string();
        assert_eq!(
            spec.args,
            vec!["start", "--cwd", &cwd_str, "--", "bash"]
                .into_iter()
                .map(str::to_owned)
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn unparseable_args_surface_error() {
        let dir = TempDir::new().unwrap();
        let err = build_terminal_spawn(
            &cfg(Some("/usr/bin/kitty"), Some("--bad 'unterminated")),
            dir.path(),
        )
        .unwrap_err();
        assert!(matches!(err, TerminalSpawnError::ArgsParse(_)));
    }

    #[test]
    fn trailing_whitespace_in_args_treated_as_empty() {
        let dir = TempDir::new().unwrap();
        let spec = build_terminal_spawn(&cfg(Some("/usr/bin/alacritty"), Some("   ")), dir.path())
            .unwrap();
        assert!(spec.args.is_empty());
    }
}
