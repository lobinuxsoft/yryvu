// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Single PUA-glyph wrapper for FiraCode Nerd Font Mono. Takes the hex
 * codepoint as a prop and emits a `<span class="nf">` with the rendered
 * character inside.
 *
 * Why a component instead of inlining the literal char in JSX:
 * Nerd-Font glyphs live in the Private Use Area and most editors,
 * commit hooks, and PR review surfaces silently strip them. Encoding
 * by codepoint keeps the source grep-able and survives every editor +
 * diff tool.
 *
 * Common codepoints (full table at nerdfonts.com/cheat-sheet):
 *
 *   close     f00d  (nf-fa-times)
 *   plus      f067  (nf-fa-plus)
 *   chevron   f078  (nf-fa-chevron_down)
 *   folder    f07b  (nf-fa-folder)
 *   star      f005  (nf-fa-star)
 *   tag       f02b  (nf-fa-tag)
 */

interface NfIconProps {
  /** Hex codepoint, e.g. "f00d". Without the U+ prefix. */
  code: string;
  /** Optional ARIA label. Omit for purely-decorative icons. */
  label?: string;
}

export function NfIcon(props: NfIconProps) {
  const char = () => String.fromCodePoint(parseInt(props.code, 16));
  return (
    <span
      class="nf"
      aria-hidden={props.label ? undefined : true}
      aria-label={props.label}
    >
      {char()}
    </span>
  );
}
