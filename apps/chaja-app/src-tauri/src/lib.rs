// SPDX-License-Identifier: AGPL-3.0-or-later

mod menu;

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
            chaja_bridge::commands::is_working_tree_dirty,
            chaja_bridge::commands::checkout_branch,
            chaja_bridge::commands::checkout_commit,
            chaja_bridge::commands::create_tag,
            chaja_bridge::commands::reset_to_commit,
            chaja_bridge::commands::cherry_pick_commit,
            chaja_bridge::commands::revert_commit,
            chaja_bridge::commands::format_patch,
            chaja_bridge::commands::stash_push,
            chaja_bridge::commands::stash_pop,
            chaja_bridge::commands::stash_count,
            chaja_bridge::commands::merge_branch,
            chaja_bridge::commands::delete_remote_branch,
            chaja_bridge::commands::abort_merge,
            chaja_bridge::commands::repo_state,
            chaja_bridge::commands::fetch_prune,
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
        ])
        .setup(|app| {
            let m = menu::build(app.handle())?;
            app.set_menu(m)?;
            Ok(())
        })
        .on_menu_event(menu::handle_event)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
