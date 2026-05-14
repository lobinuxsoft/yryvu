// SPDX-License-Identifier: AGPL-3.0-or-later

//! Editor section tests.

use tempfile::TempDir;
use yryvu_bridge::preferences::{
    file_path, load, save, EditorPreferences, EolCharacter, Preferences,
};

#[test]
fn editor_defaults_match_documented() {
    // Issue #190 (trimmed by #344) — pin every default in one place so
    // a drift in the sub-struct's Default impl shows up immediately,
    // not when a user notices their diff viewer renders differently
    // post-upgrade.
    let e = Preferences::default().editor;
    assert_eq!(e.eol_character, EolCharacter::Lf);
    assert!(!e.word_wrap);
    assert_eq!(e.tab_size, 4);
    assert!(e.show_line_numbers);
    assert!(e.syntax_highlighting);
}

#[test]
fn editor_all_fields_flipped_roundtrip() {
    let dir = TempDir::new().unwrap();
    let prefs = Preferences {
        editor: EditorPreferences {
            eol_character: EolCharacter::Crlf,
            word_wrap: true,
            tab_size: 2,
            show_line_numbers: false,
            syntax_highlighting: false,
        },
        ..Preferences::default()
    };
    save(dir.path(), &prefs).unwrap();
    let loaded = load(dir.path()).unwrap();
    assert_eq!(loaded.editor, prefs.editor);
}

#[test]
fn editor_eol_character_serializes_as_kebab_case() {
    // Frontend (wave 2) reads literal strings `"lf"` / `"crlf"` to
    // drive the `<select>` value. Drift on the rename_all attribute
    // would silently break the load path.
    for (variant, literal) in [
        (EolCharacter::Lf, "\"eolCharacter\":\"lf\""),
        (EolCharacter::Crlf, "\"eolCharacter\":\"crlf\""),
    ] {
        let prefs = Preferences {
            editor: EditorPreferences {
                eol_character: variant,
                ..EditorPreferences::default()
            },
            ..Preferences::default()
        };
        let json = serde_json::to_string(&prefs).unwrap();
        assert!(json.contains(literal), "got {json}");
    }
}

#[test]
fn editor_serializes_as_camel_case() {
    // The IPC contract is camelCase. Drift on any of the multi-word
    // fields would silently break the frontend reader — assert the
    // exact wire keys the panel will look for.
    let prefs = Preferences::default();
    let json = serde_json::to_string(&prefs).unwrap();
    for key in [
        "\"eolCharacter\"",
        "\"wordWrap\"",
        "\"tabSize\"",
        "\"showLineNumbers\"",
        "\"syntaxHighlighting\"",
    ] {
        assert!(json.contains(key), "missing wire key {key} in {json}");
    }
}

#[test]
fn editor_missing_section_falls_back_to_defaults() {
    // A preferences file written before #190 lacks the `editor`
    // section entirely. Loading must fill it with the documented
    // defaults instead of failing.
    let dir = TempDir::new().unwrap();
    std::fs::write(file_path(dir.path()), r#"{"version": 1}"#).unwrap();
    let prefs = load(dir.path()).unwrap();
    assert_eq!(prefs.editor, EditorPreferences::default());
}

#[test]
fn editor_partial_section_fills_per_field_defaults() {
    // Per-field `#[serde(default)]` means a section with only some
    // keys present must fill the missing ones individually, not
    // reject. A user that bumped only `tabSize` should not lose the
    // rest of the section on next load.
    let dir = TempDir::new().unwrap();
    std::fs::write(
        file_path(dir.path()),
        r#"{"version": 1, "editor": {"tabSize": 2}}"#,
    )
    .unwrap();
    let prefs = load(dir.path()).unwrap();
    assert_eq!(prefs.editor.tab_size, 2);
    assert_eq!(prefs.editor.eol_character, EolCharacter::Lf);
    assert!(prefs.editor.show_line_numbers);
}

#[test]
fn editor_legacy_font_keys_ignored() {
    // #344 dropped font / fontSize / showOnlyMonospace; preferences
    // files written before the cleanup still contain those keys.
    // Serde must accept them silently so users don't lose their
    // unrelated editor settings on first load post-upgrade.
    let dir = TempDir::new().unwrap();
    std::fs::write(
        file_path(dir.path()),
        r#"{"version": 1, "editor": {"font": "JetBrains Mono", "fontSize": 16, "showOnlyMonospace": false, "tabSize": 2}}"#,
    )
    .unwrap();
    let prefs = load(dir.path()).unwrap();
    assert_eq!(prefs.editor.tab_size, 2);
    assert_eq!(prefs.editor.eol_character, EolCharacter::Lf);
}
