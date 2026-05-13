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
            yryvu_bridge::commands::stream_graph,
            yryvu_bridge::commands::list_branches,
            yryvu_bridge::commands::create_branch,
            yryvu_bridge::commands::delete_local_branch,
            yryvu_bridge::commands::rename_branch,
            yryvu_bridge::commands::rebase_current_onto,
            yryvu_bridge::commands::set_upstream,
            yryvu_bridge::commands::is_working_tree_dirty,
            yryvu_bridge::commands::checkout_branch,
            yryvu_bridge::commands::checkout_remote_tracking,
            yryvu_bridge::commands::checkout_commit,
            yryvu_bridge::commands::create_tag,
            yryvu_bridge::commands::delete_tag,
            yryvu_bridge::commands::annotate_tag,
            yryvu_bridge::commands::push_tag,
            yryvu_bridge::commands::delete_tag_remote,
            yryvu_bridge::commands::list_remotes,
            yryvu_bridge::commands::add_remote,
            yryvu_bridge::commands::remove_remote,
            yryvu_bridge::commands::set_remote_url,
            yryvu_bridge::commands::import_gh_token,
            yryvu_bridge::commands::save_integration_token,
            yryvu_bridge::commands::get_integration_token,
            yryvu_bridge::commands::remove_integration_token,
            yryvu_bridge::commands::list_configured_integrations,
            yryvu_bridge::commands::set_integration_hostname,
            yryvu_bridge::commands::get_integration_hostname,
            yryvu_bridge::commands::integration_preflight,
            yryvu_bridge::commands::oauth_begin,
            yryvu_bridge::commands::oauth_await,
            yryvu_bridge::commands::oauth_cancel,
            yryvu_bridge::commands::list_tags,
            yryvu_bridge::commands::reset_to_commit,
            yryvu_bridge::commands::cherry_pick_commit,
            yryvu_bridge::commands::revert_commit,
            yryvu_bridge::commands::format_patch,
            yryvu_bridge::commands::stash_push,
            yryvu_bridge::commands::stash_pop,
            yryvu_bridge::commands::stash_pop_at,
            yryvu_bridge::commands::stash_apply,
            yryvu_bridge::commands::stash_drop,
            yryvu_bridge::commands::stash_count,
            yryvu_bridge::commands::list_stashes,
            yryvu_bridge::commands::list_worktrees,
            yryvu_bridge::commands::worktree_lock,
            yryvu_bridge::commands::worktree_unlock,
            yryvu_bridge::commands::worktree_remove,
            yryvu_bridge::commands::list_submodules,
            yryvu_bridge::commands::submodule_init,
            yryvu_bridge::commands::submodule_update,
            yryvu_bridge::commands::submodule_add,
            yryvu_bridge::commands::submodule_remove,
            yryvu_bridge::commands::merge_branch,
            yryvu_bridge::commands::delete_remote_branch,
            yryvu_bridge::commands::abort_merge,
            yryvu_bridge::commands::repo_state,
            yryvu_bridge::commands::fetch_prune,
            yryvu_bridge::commands::get_remote_url,
            yryvu_bridge::commands::commit_diff,
            yryvu_bridge::commands::combined_commit_diff,
            yryvu_bridge::commands::commit_details,
            yryvu_bridge::commands::working_tree_status,
            yryvu_bridge::commands::stage_files,
            yryvu_bridge::commands::unstage_files,
            yryvu_bridge::commands::diff_unstaged,
            yryvu_bridge::commands::diff_staged,
            yryvu_bridge::commands::commit_staged,
            yryvu_bridge::commands::amend_commit,
            yryvu_bridge::commands::head_commit_message,
            yryvu_bridge::commands::stage_all,
            yryvu_bridge::commands::unstage_all,
            yryvu_bridge::commands::discard_paths,
            yryvu_bridge::commands::create_commit,
            yryvu_bridge::commands::commit_and_push,
            yryvu_bridge::commands::get_hosting_service,
            yryvu_bridge::commands::smart_visible_refs,
            yryvu_bridge::commands::push,
            yryvu_bridge::commands::pull,
            yryvu_bridge::commands::force_pull,
            yryvu_bridge::commands::get_undo_redo_state,
            yryvu_bridge::commands::undo_last_operation,
            yryvu_bridge::commands::redo_last_undo,
            yryvu_bridge::commands::get_preferences,
            yryvu_bridge::commands::set_preferences,
            yryvu_bridge::commands::reset_preferences,
            yryvu_bridge::commands::get_repo_issue_tracker_url,
            yryvu_bridge::commands::set_repo_issue_tracker_url,
            yryvu_bridge::commands::resolve_issue_tracker_pattern,
            yryvu_bridge::commands::list_hooks,
            yryvu_bridge::commands::set_hook_enabled,
            yryvu_bridge::commands::open_hook_script,
            yryvu_bridge::commands::read_gitflow_config,
            yryvu_bridge::commands::write_gitflow_config,
            yryvu_bridge::commands::gitflow_defaults,
            yryvu_bridge::commands::open_external_terminal,
            yryvu_bridge::commands::read_changelog,
            yryvu_bridge::commands::list_known_repos,
            yryvu_bridge::commands::list_gitignore_templates,
            yryvu_bridge::commands::list_license_templates,
            yryvu_bridge::commands::init_repository,
            yryvu_bridge::commands::clone_repository,
            yryvu_bridge::commands::clone_cancel,
            yryvu_bridge::commands::validate_git_repo,
            yryvu_bridge::commands::list_themes,
            yryvu_bridge::commands::get_theme_css,
            yryvu_bridge::commands::create_theme_from_template,
            yryvu_bridge::commands::open_themes_folder,
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
                    match yryvu_bridge::themes::start_watcher(app.handle().clone(), &themes_dir) {
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
