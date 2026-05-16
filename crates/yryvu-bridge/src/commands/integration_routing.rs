// SPDX-License-Identifier: AGPL-3.0-or-later

//! Cross-command helpers for the per-provider integration routing —
//! the small classifiers that `integrations.rs` and `pr_detail.rs`
//! were both duplicating.
//!
//! Pure constexpr-ish logic; no side-effects, no async. Keeps the
//! command files focused on the IPC surface.

/// Provider family inferred from yryvu's `integration_type` string.
/// The string-to-enum lookup happens once at command entry; downstream
/// code branches on the enum which the compiler can exhaustively check.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum ProviderFamily {
    Github,
    Gitlab,
    Gitea,
    Other,
}

impl ProviderFamily {
    pub(super) fn from_integration_type(t: &str) -> Self {
        match t {
            "github" | "githubEnterprise" => Self::Github,
            "gitlab" | "gitlabSelfHosted" => Self::Gitlab,
            "gitea" | "giteaSelfHosted" => Self::Gitea,
            _ => Self::Other,
        }
    }
}

/// True when `integration_type` is the self-hosted / on-prem variant
/// of its family. yryvu's naming convention is suffix-based:
/// `*Enterprise` for GitHub Enterprise Server, `*SelfHosted` for
/// everything else. Centralised here so a new provider just slots in
/// its convention without touching every command site.
pub(super) fn is_self_hosted(integration_type: &str) -> bool {
    matches!(
        integration_type,
        "githubEnterprise" | "gitlabSelfHosted" | "giteaSelfHosted"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn family_classification() {
        for (t, expected) in [
            ("github", ProviderFamily::Github),
            ("githubEnterprise", ProviderFamily::Github),
            ("gitlab", ProviderFamily::Gitlab),
            ("gitlabSelfHosted", ProviderFamily::Gitlab),
            ("gitea", ProviderFamily::Gitea),
            ("giteaSelfHosted", ProviderFamily::Gitea),
            ("bitbucket", ProviderFamily::Other),
            ("garbage", ProviderFamily::Other),
        ] {
            assert_eq!(ProviderFamily::from_integration_type(t), expected, "{t}");
        }
    }

    #[test]
    fn self_hosted_membership() {
        for t in ["githubEnterprise", "gitlabSelfHosted", "giteaSelfHosted"] {
            assert!(is_self_hosted(t), "{t}");
        }
        for t in ["github", "gitlab", "gitea", "bitbucket", ""] {
            assert!(!is_self_hosted(t), "{t}");
        }
    }
}
