// SPDX-License-Identifier: AGPL-3.0-or-later

//! String helpers for commit rendering — author initials, message
//! subject/body split, and Gravatar hashing. Pure functions, kept out of
//! `row.rs` so that file stays a type-definitions module.

/// Two-letter initials badge for an author name. Heuristics:
///
/// - Split `name` on whitespace, drop empty tokens.
/// - If 0 tokens → fall back to the first char of `email`'s local-part,
///   else `"?"` when even that is unavailable.
/// - If 1 token → first + second char of that token (uppercased), or
///   just the first letter if the token is a single grapheme.
/// - If 2+ tokens → first char of the first token + first char of the
///   last token, uppercased.
///
/// Matches the GitKraken `authorInitials` prop surface used by
/// `getDefaultAvatar` (bundle @225102) for the initials-badge fallback.
pub fn author_initials(name: &str, email: &str) -> String {
    let tokens: Vec<&str> = name.split_whitespace().collect();
    match tokens.len() {
        0 => {
            let Some(local) = email.split('@').next() else {
                return "?".to_string();
            };
            let Some(first) = local.chars().next() else {
                return "?".to_string();
            };
            first.to_uppercase().to_string()
        }
        1 => {
            let mut it = tokens[0].chars();
            let first = it
                .next()
                .map(|c| c.to_uppercase().to_string())
                .unwrap_or_default();
            let second = it
                .next()
                .map(|c| c.to_uppercase().to_string())
                .unwrap_or_default();
            format!("{first}{second}")
        }
        _ => {
            let first_token = tokens.first().copied().unwrap_or_default();
            let last_token = tokens.last().copied().unwrap_or_default();
            let first = first_token
                .chars()
                .next()
                .map(|c| c.to_uppercase().to_string())
                .unwrap_or_default();
            let last = last_token
                .chars()
                .next()
                .map(|c| c.to_uppercase().to_string())
                .unwrap_or_default();
            format!("{first}{last}")
        }
    }
}

/// Split a full commit message into `(subject, body)`.
///
/// Subject is everything up to the first newline (`\n` or `\r`); body is
/// everything after, with leading newline characters trimmed so the two
/// forms `"subj\n\nbody"` and `"subj\nbody"` both produce body `"body"`.
///
/// Matches the GitKraken render pipeline (`03-message-section.md`):
/// char-by-char iteration, first delimiter wins, no regex. The blank-line
/// separator convention is git's canonical format (`git show --format='%s%n%n%b'`).
/// Trailing whitespace on the body is preserved — consumers decide whether
/// to trim.
///
/// Empty input returns `("", "")`. Subject-only input (no newline) returns
/// `(input, "")`. Body is never `None`; the empty string covers both cases.
pub fn split_message(full: &str) -> (String, String) {
    match full.find(['\n', '\r']) {
        Some(idx) => {
            let subject = full[..idx].to_string();
            let body = full[idx..].trim_start_matches(['\n', '\r']).to_string();
            (subject, body)
        }
        None => (full.to_string(), String::new()),
    }
}

/// Lowercase-hex MD5 of the trimmed-lowercased email, as Gravatar expects.
/// Returns a 32-char hex string (stable across callers so avatars can be
/// keyed by email without re-hashing per render).
pub fn gravatar_hash(email: &str) -> String {
    use md5::{Digest, Md5};
    let normalized = email.trim().to_lowercase();
    let digest = Md5::digest(normalized.as_bytes());
    let mut out = String::with_capacity(32);
    for byte in digest {
        // Manual hex rather than `format!` in a loop — tight.
        const HEX: &[u8; 16] = b"0123456789abcdef";
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn initials_two_words() {
        assert_eq!(author_initials("John Doe", "john@doe.com"), "JD");
    }

    #[test]
    fn initials_single_word_uses_first_two_chars() {
        assert_eq!(author_initials("Cher", "c@x.com"), "CH");
    }

    #[test]
    fn initials_three_words_uses_first_and_last() {
        assert_eq!(author_initials("Jose Maria Lopez", "jml@x.com"), "JL");
    }

    #[test]
    fn initials_empty_name_falls_back_to_email_local_part() {
        assert_eq!(author_initials("", "alice@example.com"), "A");
    }

    #[test]
    fn initials_empty_name_empty_email_question_mark() {
        assert_eq!(author_initials("", ""), "?");
    }

    #[test]
    fn initials_unicode_two_words() {
        // Confirms chars() iteration plus to_uppercase handles non-ASCII.
        assert_eq!(author_initials("Ñandú Öztürk", "x@y.com"), "ÑÖ");
    }

    #[test]
    fn gravatar_hash_standard_example() {
        // https://docs.gravatar.com/api/avatars/hash/
        assert_eq!(
            gravatar_hash("MyEmailAddress@example.com "),
            "0bc83cb571cd1c50ba6f3e8a78ef1346"
        );
    }

    #[test]
    fn gravatar_hash_is_stable_on_case_and_whitespace() {
        let a = gravatar_hash("test@example.com");
        let b = gravatar_hash("  TEST@EXAMPLE.COM  ");
        assert_eq!(a, b);
    }

    #[test]
    fn split_message_subject_only() {
        let (s, b) = split_message("feat: add thing");
        assert_eq!(s, "feat: add thing");
        assert_eq!(b, "");
    }

    #[test]
    fn split_message_with_blank_line_separator() {
        let (s, b) = split_message("feat: add thing\n\nLong description\nSecond line");
        assert_eq!(s, "feat: add thing");
        assert_eq!(b, "Long description\nSecond line");
    }

    #[test]
    fn split_message_without_blank_line_separator() {
        // Pathological: commit without the canonical blank-line separator.
        // Body collapses to whatever comes after the first newline.
        let (s, b) = split_message("subject\nbody");
        assert_eq!(s, "subject");
        assert_eq!(b, "body");
    }

    #[test]
    fn split_message_crlf_separator() {
        let (s, b) = split_message("subject\r\n\r\nbody");
        assert_eq!(s, "subject");
        assert_eq!(b, "body");
    }

    #[test]
    fn split_message_empty_input() {
        let (s, b) = split_message("");
        assert_eq!(s, "");
        assert_eq!(b, "");
    }

    #[test]
    fn split_message_preserves_body_trailing_whitespace() {
        let (s, b) = split_message("subj\n\nbody\n");
        assert_eq!(s, "subj");
        assert_eq!(b, "body\n");
    }
}
