// SPDX-License-Identifier: AGPL-3.0-or-later

//! Curated gitignore templates sourced from github/gitignore (CC0).

use super::TemplateEntry;

pub const ALL_GITIGNORE: &[TemplateEntry] = &[
    TemplateEntry {
        name: "c",
        display_label: "C",
        content: include_str!("../../resources/gitignore/c.gitignore"),
    },
    TemplateEntry {
        name: "cpp",
        display_label: "C++",
        content: include_str!("../../resources/gitignore/cpp.gitignore"),
    },
    TemplateEntry {
        name: "rust",
        display_label: "Rust",
        content: include_str!("../../resources/gitignore/rust.gitignore"),
    },
    TemplateEntry {
        name: "go",
        display_label: "Go",
        content: include_str!("../../resources/gitignore/go.gitignore"),
    },
    TemplateEntry {
        name: "python",
        display_label: "Python",
        content: include_str!("../../resources/gitignore/python.gitignore"),
    },
    TemplateEntry {
        name: "node",
        display_label: "Node",
        content: include_str!("../../resources/gitignore/node.gitignore"),
    },
    TemplateEntry {
        name: "java",
        display_label: "Java",
        content: include_str!("../../resources/gitignore/java.gitignore"),
    },
    TemplateEntry {
        name: "kotlin",
        display_label: "Kotlin",
        content: include_str!("../../resources/gitignore/kotlin.gitignore"),
    },
    TemplateEntry {
        name: "swift",
        display_label: "Swift",
        content: include_str!("../../resources/gitignore/swift.gitignore"),
    },
    TemplateEntry {
        name: "dart",
        display_label: "Dart",
        content: include_str!("../../resources/gitignore/dart.gitignore"),
    },
    TemplateEntry {
        name: "ruby",
        display_label: "Ruby",
        content: include_str!("../../resources/gitignore/ruby.gitignore"),
    },
    TemplateEntry {
        name: "php",
        display_label: "PHP",
        content: include_str!("../../resources/gitignore/php.gitignore"),
    },
    TemplateEntry {
        name: "scala",
        display_label: "Scala",
        content: include_str!("../../resources/gitignore/scala.gitignore"),
    },
    TemplateEntry {
        name: "haskell",
        display_label: "Haskell",
        content: include_str!("../../resources/gitignore/haskell.gitignore"),
    },
    TemplateEntry {
        name: "elixir",
        display_label: "Elixir",
        content: include_str!("../../resources/gitignore/elixir.gitignore"),
    },
    TemplateEntry {
        name: "android",
        display_label: "Android",
        content: include_str!("../../resources/gitignore/android.gitignore"),
    },
    TemplateEntry {
        name: "unity",
        display_label: "Unity",
        content: include_str!("../../resources/gitignore/unity.gitignore"),
    },
    TemplateEntry {
        name: "unreal",
        display_label: "Unreal Engine",
        content: include_str!("../../resources/gitignore/unreal.gitignore"),
    },
    TemplateEntry {
        name: "godot",
        display_label: "Godot",
        content: include_str!("../../resources/gitignore/godot.gitignore"),
    },
    TemplateEntry {
        name: "laravel",
        display_label: "Laravel",
        content: include_str!("../../resources/gitignore/laravel.gitignore"),
    },
    TemplateEntry {
        name: "rails",
        display_label: "Rails",
        content: include_str!("../../resources/gitignore/rails.gitignore"),
    },
    TemplateEntry {
        name: "cmake",
        display_label: "CMake",
        content: include_str!("../../resources/gitignore/cmake.gitignore"),
    },
    TemplateEntry {
        name: "gradle",
        display_label: "Gradle",
        content: include_str!("../../resources/gitignore/gradle.gitignore"),
    },
    TemplateEntry {
        name: "linux",
        display_label: "Linux (Global)",
        content: include_str!("../../resources/gitignore/linux.gitignore"),
    },
    TemplateEntry {
        name: "macos",
        display_label: "macOS (Global)",
        content: include_str!("../../resources/gitignore/macos.gitignore"),
    },
    TemplateEntry {
        name: "windows",
        display_label: "Windows (Global)",
        content: include_str!("../../resources/gitignore/windows.gitignore"),
    },
    TemplateEntry {
        name: "jetbrains",
        display_label: "JetBrains IDEs (Global)",
        content: include_str!("../../resources/gitignore/jetbrains.gitignore"),
    },
    TemplateEntry {
        name: "vscode",
        display_label: "Visual Studio Code (Global)",
        content: include_str!("../../resources/gitignore/vscode.gitignore"),
    },
    TemplateEntry {
        name: "vim",
        display_label: "Vim (Global)",
        content: include_str!("../../resources/gitignore/vim.gitignore"),
    },
    TemplateEntry {
        name: "emacs",
        display_label: "Emacs (Global)",
        content: include_str!("../../resources/gitignore/emacs.gitignore"),
    },
];
