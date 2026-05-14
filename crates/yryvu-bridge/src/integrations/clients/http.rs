// SPDX-License-Identifier: AGPL-3.0-or-later

//! Shared HTTP helper for every per-provider client. Centralises:
//!
//! - Status-code → [`BackendError`] mapping with per-provider quirks
//!   (rate-limit header name, scope advice on 403).
//! - The `reqwest::Client` builder so the User-Agent + TLS feature
//!   choice stay consistent across providers.
//!
//! Each provider passes a [`Quirks`] table; the helper handles the
//! cross-cutting status-code logic the callsite no longer has to
//! repeat. The body is intentionally tiny — the goal is to make
//! each provider's `preflight` / `list` / `search` fit in 20 lines
//! of HTTP plumbing instead of 50.

use reqwest::{header, Method, RequestBuilder, Response, StatusCode};

use crate::backend::BackendError;

/// Per-provider HTTP quirks. Each provider knows its rate-limit
/// header name + what to advise users when 403 hits.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Quirks {
    /// Header carrying the unix-epoch reset timestamp. GitHub uses
    /// `x-ratelimit-reset`; GitLab uses `ratelimit-reset` (RFC 9239).
    pub rate_limit_reset_header: &'static str,
    /// Header reporting how many calls remain before rate-limit
    /// kicks in. Only used to disambiguate 403 → RateLimited vs
    /// 403 → InvalidToken; some providers (GitLab) don't expose it,
    /// in which case we map 403 directly per `forbidden_kind`.
    pub rate_limit_remaining_header: Option<&'static str>,
    /// What 403 means absent a rate-limit signal.
    pub forbidden_kind: ForbiddenKind,
}

/// Disposition for a 403 response when the rate-limit signal is
/// absent or doesn't indicate exhaustion.
#[derive(Debug, Clone, Copy)]
pub(crate) enum ForbiddenKind {
    /// Most likely an invalid token (scope-revoked / wrong audience).
    InvalidToken,
    /// Token authenticated but lacks the required scope; surface
    /// with the canonical advice string.
    InsufficientScopes {
        granted: &'static str,
        required: &'static str,
    },
}

pub(crate) const USER_AGENT: &str = "yryvu";

pub(crate) const GITHUB_QUIRKS: Quirks = Quirks {
    rate_limit_reset_header: "x-ratelimit-reset",
    rate_limit_remaining_header: Some("x-ratelimit-remaining"),
    forbidden_kind: ForbiddenKind::InvalidToken,
};

pub(crate) const GITLAB_QUIRKS: Quirks = Quirks {
    rate_limit_reset_header: "ratelimit-reset",
    rate_limit_remaining_header: None,
    forbidden_kind: ForbiddenKind::InsufficientScopes {
        granted: "unknown",
        required: "read_api",
    },
};

/// GitLab preflight (`currentUser`) only requires `read_user`; a 403
/// there means an actively rejected token, not a missing scope.
pub(crate) const GITLAB_PREFLIGHT_QUIRKS: Quirks = Quirks {
    rate_limit_reset_header: "ratelimit-reset",
    rate_limit_remaining_header: None,
    forbidden_kind: ForbiddenKind::InvalidToken,
};

pub(crate) const GITEA_QUIRKS: Quirks = Quirks {
    rate_limit_reset_header: "x-ratelimit-reset",
    rate_limit_remaining_header: None,
    forbidden_kind: ForbiddenKind::InsufficientScopes {
        granted: "unknown",
        required: "read:repository, read:user",
    },
};

/// 403 disposition specifically for GitHub PATCH mutations — almost
/// always missing the write `repo` scope, so the advice differs from
/// the read-side default.
pub(crate) const GITHUB_PATCH_QUIRKS: Quirks = Quirks {
    rate_limit_reset_header: "x-ratelimit-reset",
    rate_limit_remaining_header: Some("x-ratelimit-remaining"),
    forbidden_kind: ForbiddenKind::InsufficientScopes {
        granted: "read-only",
        required: "repo (write)",
    },
};

/// Build a `reqwest::Client` with our canonical User-Agent. Callers
/// who need extra config (timeouts, redirects) wrap this with
/// further builder steps.
pub(crate) fn client() -> Result<reqwest::Client, BackendError> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .build()
        .map_err(network_error)
}

/// Construct an authenticated request builder with the canonical
/// `Authorization: Bearer ...` + `Accept` headers. Saves the four
/// `.header(...)` lines every callsite was repeating.
pub(crate) fn authed(
    client: &reqwest::Client,
    method: Method,
    url: &str,
    token: &str,
    accept: &'static str,
) -> RequestBuilder {
    client
        .request(method, url)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::ACCEPT, accept)
}

/// Execute a request and map status codes to typed errors per
/// `quirks`. 2xx returns the response unchanged.
pub(crate) async fn execute(req: RequestBuilder, quirks: Quirks) -> Result<Response, BackendError> {
    let resp = req.send().await.map_err(network_error)?;
    let status = resp.status();
    if status.is_success() {
        return Ok(resp);
    }
    Err(map_status(&resp, status, quirks))
}

fn map_status(resp: &Response, status: StatusCode, quirks: Quirks) -> BackendError {
    match status {
        StatusCode::UNAUTHORIZED => BackendError::InvalidToken,
        StatusCode::TOO_MANY_REQUESTS => BackendError::RateLimited {
            reset_at: read_reset(resp, quirks.rate_limit_reset_header),
        },
        StatusCode::FORBIDDEN => map_forbidden(resp, quirks),
        StatusCode::NOT_FOUND => BackendError::NetworkError {
            detail: format!("not found or token cannot see it (HTTP {status})"),
        },
        other => BackendError::NetworkError {
            detail: format!("unexpected HTTP {other}"),
        },
    }
}

fn map_forbidden(resp: &Response, quirks: Quirks) -> BackendError {
    if let Some(header_name) = quirks.rate_limit_remaining_header {
        let remaining = resp
            .headers()
            .get(header_name)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.parse::<u64>().ok());
        if remaining == Some(0) {
            return BackendError::RateLimited {
                reset_at: read_reset(resp, quirks.rate_limit_reset_header),
            };
        }
    }
    match quirks.forbidden_kind {
        ForbiddenKind::InvalidToken => BackendError::InvalidToken,
        ForbiddenKind::InsufficientScopes { granted, required } => {
            BackendError::InsufficientScopes {
                granted: granted.to_string(),
                required: required.to_string(),
            }
        }
    }
}

fn read_reset(resp: &Response, header_name: &str) -> u64 {
    resp.headers()
        .get(header_name)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0)
}

pub(crate) fn network_error<E: std::fmt::Display>(e: E) -> BackendError {
    BackendError::NetworkError {
        detail: e.to_string(),
    }
}

pub(crate) fn decode_error(prefix: &str, e: impl std::fmt::Display) -> BackendError {
    BackendError::NetworkError {
        detail: format!("{prefix}: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quirks_constants_consistent() {
        // Cheap sanity check that the three baseline quirks have
        // non-empty reset headers — callers depend on that for the
        // RateLimited mapping.
        assert!(!GITHUB_QUIRKS.rate_limit_reset_header.is_empty());
        assert!(!GITLAB_QUIRKS.rate_limit_reset_header.is_empty());
        assert!(!GITEA_QUIRKS.rate_limit_reset_header.is_empty());
    }
}
