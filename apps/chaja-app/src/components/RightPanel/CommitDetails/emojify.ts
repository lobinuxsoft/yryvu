// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Replace `:shortcode:` emoji tokens with their unicode character.
 *
 * Mirrors GitKraken's single commit-message transform (bundle verified
 * 2026-04-23): the inspector renders `emojify(body)` with no markdown,
 * no linkify, no issue-ref transforms. The bundle uses a full shortcode
 * dictionary; here we ship the subset that actually appears in commit
 * messages (gitmoji + a few common emoji codes). Anything unknown passes
 * through verbatim.
 */

const SHORTCODES: Record<string, string> = {
  // Gitmoji — the subset that commit authors actually type.
  // https://gitmoji.dev
  sparkles: "✨",
  bug: "🐛",
  fire: "🔥",
  rocket: "🚀",
  lipstick: "💄",
  tada: "🎉",
  white_check_mark: "✅",
  lock: "🔒",
  closed_lock_with_key: "🔐",
  bookmark: "🔖",
  rotating_light: "🚨",
  construction: "🚧",
  green_heart: "💚",
  arrow_down: "⬇️",
  arrow_up: "⬆️",
  pushpin: "📌",
  construction_worker: "👷",
  chart_with_upwards_trend: "📈",
  recycle: "♻️",
  heavy_plus_sign: "➕",
  heavy_minus_sign: "➖",
  wrench: "🔧",
  hammer: "🔨",
  globe_with_meridians: "🌐",
  pencil2: "✏️",
  poop: "💩",
  rewind: "⏪",
  twisted_rightwards_arrows: "🔀",
  package: "📦",
  alien: "👽",
  truck: "🚚",
  page_facing_up: "📄",
  bento: "🍱",
  children_crossing: "🚸",
  building_construction: "🏗️",
  iphone: "📱",
  clown_face: "🤡",
  egg: "🥚",
  see_no_evil: "🙈",
  camera_flash: "📸",
  alembic: "⚗️",
  mag: "🔍",
  label: "🏷️",
  seedling: "🌱",
  triangular_flag_on_post: "🚩",
  goal_net: "🥅",
  dizzy: "💫",
  wheelchair: "♿",
  // Plain emoji shortcodes authors sometimes use in messages.
  check: "✔️",
  warning: "⚠️",
  zap: "⚡",
  boom: "💥",
  sparkle: "❇️",
  star: "⭐",
  heart: "❤️",
  "+1": "👍",
  "-1": "👎",
};

const SHORTCODE_RE = /:([a-z0-9_+\-]+):/gi;

export function emojify(text: string): string {
  return text.replace(SHORTCODE_RE, (match, code: string) => {
    const replacement = SHORTCODES[code.toLowerCase()];
    return replacement ?? match;
  });
}
