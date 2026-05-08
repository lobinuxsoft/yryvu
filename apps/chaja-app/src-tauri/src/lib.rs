// SPDX-License-Identifier: AGPL-3.0-or-later

mod menu;

use tauri::Manager;
use tracing::warn;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            chaja_bridge::commands::stream_graph,
            chaja_bridge::commands::list_branches,
            chaja_bridge::commands::create_branch,
            chaja_bridge::commands::delete_local_branch,
            chaja_bridge::commands::rename_branch,
            chaja_bridge::commands::rebase_current_onto,
            chaja_bridge::commands::set_upstream,
            chaja_bridge::commands::is_working_tree_dirty,
            chaja_bridge::commands::checkout_branch,
            chaja_bridge::commands::checkout_remote_tracking,
            chaja_bridge::commands::checkout_commit,
            chaja_bridge::commands::create_tag,
            chaja_bridge::commands::delete_tag,
            chaja_bridge::commands::annotate_tag,
            chaja_bridge::commands::push_tag,
            chaja_bridge::commands::delete_tag_remote,
            chaja_bridge::commands::list_remotes,
            chaja_bridge::commands::add_remote,
            chaja_bridge::commands::remove_remote,
            chaja_bridge::commands::set_remote_url,
            chaja_bridge::commands::import_gh_token,
            chaja_bridge::commands::save_integration_token,
            chaja_bridge::commands::get_integration_token,
            chaja_bridge::commands::remove_integration_token,
            chaja_bridge::commands::list_configured_integrations,
            chaja_bridge::commands::set_integration_hostname,
            chaja_bridge::commands::get_integration_hostname,
            chaja_bridge::commands::integration_preflight,
            chaja_bridge::commands::oauth_begin,
            chaja_bridge::commands::oauth_await,
            chaja_bridge::commands::oauth_cancel,
            chaja_bridge::commands::list_tags,
            chaja_bridge::commands::reset_to_commit,
            chaja_bridge::commands::cherry_pick_commit,
            chaja_bridge::commands::revert_commit,
            chaja_bridge::commands::format_patch,
            chaja_bridge::commands::stash_push,
            chaja_bridge::commands::stash_pop,
            chaja_bridge::commands::stash_pop_at,
            chaja_bridge::commands::stash_apply,
            chaja_bridge::commands::stash_drop,
            chaja_bridge::commands::stash_count,
            chaja_bridge::commands::list_stashes,
            chaja_bridge::commands::list_worktrees,
            chaja_bridge::commands::worktree_lock,
            chaja_bridge::commands::worktree_unlock,
            chaja_bridge::commands::worktree_remove,
            chaja_bridge::commands::list_submodules,
            chaja_bridge::commands::submodule_init,
            chaja_bridge::commands::submodule_update,
            chaja_bridge::commands::submodule_add,
            chaja_bridge::commands::submodule_remove,
            chaja_bridge::commands::merge_branch,
            chaja_bridge::commands::delete_remote_branch,
            chaja_bridge::commands::abort_merge,
            chaja_bridge::commands::repo_state,
            chaja_bridge::commands::fetch_prune,
            chaja_bridge::commands::get_remote_url,
            chaja_bridge::commands::commit_diff,
            chaja_bridge::commands::combined_commit_diff,
            chaja_bridge::commands::commit_details,
            chaja_bridge::commands::working_tree_status,
            chaja_bridge::commands::stage_files,
            chaja_bridge::commands::unstage_files,
            chaja_bridge::commands::diff_unstaged,
            chaja_bridge::commands::diff_staged,
            chaja_bridge::commands::commit_staged,
            chaja_bridge::commands::amend_commit,
            chaja_bridge::commands::head_commit_message,
            chaja_bridge::commands::stage_all,
            chaja_bridge::commands::unstage_all,
            chaja_bridge::commands::discard_paths,
            chaja_bridge::commands::create_commit,
            chaja_bridge::commands::commit_and_push,
            chaja_bridge::commands::get_hosting_service,
            chaja_bridge::commands::smart_visible_refs,
            chaja_bridge::commands::push,
            chaja_bridge::commands::pull,
            chaja_bridge::commands::force_pull,
            chaja_bridge::commands::get_undo_redo_state,
            chaja_bridge::commands::undo_last_operation,
            chaja_bridge::commands::redo_last_undo,
            chaja_bridge::commands::get_preferences,
            chaja_bridge::commands::set_preferences,
            chaja_bridge::commands::reset_preferences,
            chaja_bridge::commands::read_changelog,
            chaja_bridge::commands::list_known_repos,
            chaja_bridge::commands::list_gitignore_templates,
            chaja_bridge::commands::list_license_templates,
            chaja_bridge::commands::init_repository,
            chaja_bridge::commands::clone_repository,
            chaja_bridge::commands::clone_cancel,
            chaja_bridge::commands::validate_git_repo,
            chaja_bridge::commands::list_themes,
            chaja_bridge::commands::get_theme_css,
            chaja_bridge::commands::create_theme_from_template,
            chaja_bridge::commands::open_themes_folder,
        ])
        .setup(|app| {
            let m = menu::build(app.handle())?;
            app.set_menu(m)?;

            // File watcher for `<config>/themes/` — emits `theme-changed`
            // on edits so the frontend can hot-reload the active theme.
            // Held in app state so the debouncer thread lives as long as
            // the app does.
            match app.path().app_config_dir() {
                Ok(config) => {
                    let themes_dir = config.join("themes");
                    match chaja_bridge::themes::start_watcher(app.handle().clone(), &themes_dir) {
                        Ok(handle) => {
                            app.manage(handle);
                        }
                        Err(e) => {
                            warn!("failed to start themes watcher: {e}");
                        }
                    }
                }
                Err(e) => warn!("failed to resolve app_config_dir for themes watcher: {e}"),
            }

            Ok(())
        })
        .on_menu_event(menu::handle_event)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
