// SPDX-License-Identifier: AGPL-3.0-or-later

use tauri::{
    menu::{Menu, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder},
    AppHandle, Emitter, Runtime,
};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let file = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("file_new_tab", "New Tab")
                .accelerator("CmdOrCtrl+T")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("file_close_tab", "Close Tab")
                .accelerator("CmdOrCtrl+W")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("file_clone_repo", "Clone Repo…")
                .accelerator("CmdOrCtrl+N")
                .enabled(false)
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("file_init_repo", "Init Repo…")
                .accelerator("CmdOrCtrl+I")
                .enabled(false)
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("file_open_repo", "Open Repo…")
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("file_preferences", "Preferences…")
                .accelerator("CmdOrCtrl+Comma")
                .enabled(false)
                .build(app)?,
        )
        .separator()
        .item(&PredefinedMenuItem::quit(app, Some("Quit"))?)
        .build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("view_toggle_left", "Show Left Panel")
                .accelerator("CmdOrCtrl+J")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("view_toggle_right", "Show Commit Details Panel")
                .accelerator("CmdOrCtrl+K")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("view_toggle_terminal", "Show Terminal Panel")
                .accelerator("CmdOrCtrl+`")
                .build(app)?,
        )
        .build()?;

    let help = SubmenuBuilder::new(app, "Help")
        .item(
            &MenuItemBuilder::with_id("help_command_palette", "Open Command Palette")
                .accelerator("CmdOrCtrl+P")
                .enabled(false)
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("help_shortcuts", "Keyboard Shortcuts")
                .accelerator("CmdOrCtrl+Slash")
                .enabled(false)
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("help_about", "About Chajá").build(app)?)
        .build()?;

    MenuBuilder::new(app)
        .items(&[&file, &edit, &view, &help])
        .build()
}

pub fn handle_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    let id = event.id().as_ref();
    let channel = match id {
        "file_new_tab" => Some("menu:new-tab"),
        "file_close_tab" => Some("menu:close-tab"),
        "file_open_repo" => Some("menu:open-repo"),
        "file_clone_repo" => Some("menu:clone-repo"),
        "file_init_repo" => Some("menu:init-repo"),
        "file_preferences" => Some("menu:preferences"),
        "view_toggle_left" => Some("menu:toggle-left-panel"),
        "view_toggle_right" => Some("menu:toggle-right-panel"),
        "view_toggle_terminal" => Some("menu:toggle-terminal"),
        "help_command_palette" => Some("menu:command-palette"),
        "help_shortcuts" => Some("menu:shortcuts"),
        "help_about" => Some("menu:about"),
        _ => None,
    };
    if let Some(ch) = channel {
        let _ = app.emit(ch, ());
    }
}
