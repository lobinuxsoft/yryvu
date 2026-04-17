// SPDX-License-Identifier: AGPL-3.0-or-later

/// Stable color index for a lane given a seed (usually the SHA that opened the lane).
///
/// Uses blake3 so the mapping is deterministic across sessions and platforms.
pub fn color_idx_for(seed: &str, palette_size: u16) -> u16 {
    debug_assert!(palette_size > 0, "palette_size must be positive");
    let hash = blake3::hash(seed.as_bytes());
    let bytes = hash.as_bytes();
    let n = u16::from_le_bytes([bytes[0], bytes[1]]);
    n % palette_size
}
