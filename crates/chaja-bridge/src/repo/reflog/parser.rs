// SPDX-License-Identifier: AGPL-3.0-or-later

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PassAOutcome<'a> {
    None,
    DisqualifiedByReset,
    Base(&'a str),
}

/// Pass A: scan the reflog text, top-to-bottom (oldest-first as written by Git).
/// Returns the most recent `branch: Created from <X>` or `branch: Reset to <X>`
/// capture, unless any `reset: moving to ` line is present anywhere — which
/// disqualifies the lookup.
pub(super) fn parse_pass_a(reflog: &str) -> Option<String> {
    let mut newest_base: Option<String> = None;

    for line in reflog.lines() {
        let Some(msg) = reflog_message(line) else {
            continue;
        };
        match classify_pass_a(msg) {
            PassAOutcome::DisqualifiedByReset => return None,
            PassAOutcome::Base(name) => newest_base = Some(name.to_string()),
            PassAOutcome::None => {}
        }
    }

    newest_base
}

fn classify_pass_a(msg: &str) -> PassAOutcome<'_> {
    if msg.starts_with("reset: moving to ") {
        return PassAOutcome::DisqualifiedByReset;
    }
    if let Some(rest) = msg.strip_prefix("branch: Created from ") {
        return PassAOutcome::Base(rest);
    }
    if let Some(rest) = msg.strip_prefix("branch: Reset to ") {
        return PassAOutcome::Base(rest);
    }
    PassAOutcome::None
}

/// Pass B: walk the reflog and return the source side of the *oldest*
/// `checkout: moving from <X> to <head_shorthand>` line. `--walk-reflogs`
/// emits newest-first, so "oldest" is GitKraken's "last match" — the moment
/// the branch was first established with HEAD as its base.
pub(super) fn parse_pass_b(reflog: &str, head_shorthand: &str) -> Option<String> {
    let suffix = format!(" to {head_shorthand}");
    for line in reflog.lines() {
        let Some(msg) = reflog_message(line) else {
            continue;
        };
        let Some(rest) = msg.strip_prefix("checkout: moving from ") else {
            continue;
        };
        if let Some(from) = rest.strip_suffix(suffix.as_str()) {
            return Some(from.to_string());
        }
    }
    None
}

/// Extract the message segment of a single reflog line (everything after the
/// tab that follows the metadata header). Returns `None` for malformed lines.
fn reflog_message(line: &str) -> Option<&str> {
    let tab_idx = line.find('\t')?;
    Some(&line[tab_idx + 1..])
}

/// Strip a `refs/heads/` prefix from a full ref name. Returns the input
/// unchanged if it does not look like a local branch full name.
pub(super) fn shorthand_for_local_branch(full_name: &str) -> &str {
    full_name.strip_prefix("refs/heads/").unwrap_or(full_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(oid_old: &str, oid_new: &str, msg: &str) -> String {
        format!("{oid_old} {oid_new} Some User <user@example.com> 1700000000 +0000\t{msg}\n")
    }

    #[test]
    fn pass_a_returns_newest_base() {
        let reflog = format!(
            "{}{}{}",
            line(
                "0".repeat(40).as_str(),
                "a".repeat(40).as_str(),
                "branch: Created from main"
            ),
            line(
                "a".repeat(40).as_str(),
                "b".repeat(40).as_str(),
                "commit: tweak"
            ),
            line(
                "b".repeat(40).as_str(),
                "c".repeat(40).as_str(),
                "branch: Reset to develop"
            ),
        );
        assert_eq!(parse_pass_a(&reflog), Some("develop".to_string()));
    }

    #[test]
    fn pass_a_disqualified_by_reset_moving_to() {
        let reflog = format!(
            "{}{}",
            line(
                "0".repeat(40).as_str(),
                "a".repeat(40).as_str(),
                "branch: Created from main"
            ),
            line(
                "a".repeat(40).as_str(),
                "b".repeat(40).as_str(),
                "reset: moving to abc1234"
            ),
        );
        assert_eq!(parse_pass_a(&reflog), None);
    }

    #[test]
    fn pass_a_returns_none_for_unrelated_messages() {
        let reflog = format!(
            "{}{}",
            line(
                "0".repeat(40).as_str(),
                "a".repeat(40).as_str(),
                "commit: initial"
            ),
            line(
                "a".repeat(40).as_str(),
                "b".repeat(40).as_str(),
                "commit (amend): tweak"
            ),
        );
        assert_eq!(parse_pass_a(&reflog), None);
    }

    #[test]
    fn pass_a_returns_none_for_empty_reflog() {
        assert_eq!(parse_pass_a(""), None);
    }

    #[test]
    fn pass_a_skips_malformed_lines() {
        let reflog = format!(
            "no-tab-here\n{}",
            line(
                "0".repeat(40).as_str(),
                "a".repeat(40).as_str(),
                "branch: Created from feature/x"
            ),
        );
        assert_eq!(parse_pass_a(&reflog), Some("feature/x".to_string()));
    }

    #[test]
    fn pass_a_handles_branch_name_with_slashes() {
        let reflog = line(
            "0".repeat(40).as_str(),
            "a".repeat(40).as_str(),
            "branch: Created from origin/release/1.0",
        );
        assert_eq!(
            parse_pass_a(&reflog),
            Some("origin/release/1.0".to_string())
        );
    }

    #[test]
    fn pass_b_returns_oldest_checkout_to_target() {
        let reflog = format!(
            "{}{}{}",
            line(
                "0".repeat(40).as_str(),
                "a".repeat(40).as_str(),
                "checkout: moving from main to feature/x"
            ),
            line(
                "a".repeat(40).as_str(),
                "b".repeat(40).as_str(),
                "checkout: moving from feature/x to develop"
            ),
            line(
                "b".repeat(40).as_str(),
                "c".repeat(40).as_str(),
                "checkout: moving from develop to feature/x"
            ),
        );
        assert_eq!(parse_pass_b(&reflog, "feature/x"), Some("main".to_string()));
    }

    #[test]
    fn pass_b_returns_none_when_target_never_checked_out() {
        let reflog = line(
            "0".repeat(40).as_str(),
            "a".repeat(40).as_str(),
            "checkout: moving from main to develop",
        );
        assert_eq!(parse_pass_b(&reflog, "feature/x"), None);
    }

    #[test]
    fn pass_b_distinguishes_substring_target() {
        let reflog = format!(
            "{}{}",
            line(
                "0".repeat(40).as_str(),
                "a".repeat(40).as_str(),
                "checkout: moving from main to feature/x-2"
            ),
            line(
                "a".repeat(40).as_str(),
                "b".repeat(40).as_str(),
                "checkout: moving from main to feature/x"
            ),
        );
        assert_eq!(parse_pass_b(&reflog, "feature/x"), Some("main".to_string()));
    }

    #[test]
    fn shorthand_strips_heads_prefix() {
        assert_eq!(shorthand_for_local_branch("refs/heads/main"), "main");
        assert_eq!(
            shorthand_for_local_branch("refs/heads/feature/x"),
            "feature/x"
        );
        assert_eq!(shorthand_for_local_branch("HEAD"), "HEAD");
        assert_eq!(
            shorthand_for_local_branch("refs/remotes/origin/main"),
            "refs/remotes/origin/main"
        );
    }
}
