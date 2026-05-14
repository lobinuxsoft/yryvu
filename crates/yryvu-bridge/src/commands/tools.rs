// SPDX-License-Identifier: AGPL-3.0-or-later

//! Tauri commands for the `tools` preferences section (issue #105).
//! Currently exposes a single command — `open_external_terminal` — that
//! resolves the user's `ExternalTerminal` config and spawns the
//! configured binary in the given repo path. Argv composition lives in
//! `preferences::build_terminal_spawn` (testable without a real
//! terminal); this module owns only the I/O wiring (load preferences,
//! `Command::spawn`).

use std::path::PathBuf;
use std::process::Command;

use tauri::{AppHandle, Manager};

use crate::preferences::{self, build_terminal_spawn};

#[tauri::command]
pub async fn open_external_terminal(app: AppHandle, repo_path: String) -> Result<(), String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let target = PathBuf::from(repo_path);
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        let prefs = preferences::load(&config_dir).map_err(|e| e.to_string())?;
        let spec = build_terminal_spawn(&prefs.tools.external_terminal, &target)
            .map_err(|e| e.to_string())?;
        Command::new(&spec.binary)
            .args(&spec.args)
            .current_dir(&spec.cwd)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("failed to spawn `{}`: {e}", spec.binary))
    })
    .await
    .map_err(|e| e.to_string())?
}
