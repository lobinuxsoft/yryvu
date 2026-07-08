// SPDX-License-Identifier: AGPL-3.0-or-later

/// Git LFS pointer files start with this version line (research doc 07).
const LFS_VERSION_PREFIX = "version https://git-lfs.github.com/spec/v1";

/// Detect a Git LFS pointer from file content and pull out the object
/// size. Detection is a post-load check that applies regardless of the
/// file's `fileDataType` — a pointer is small UTF-8 text, so it loads
/// like any other text file. Returns `null` for ordinary content.
export function parseLfsPointer(content: string): { size: number } | null {
  if (!content.startsWith(LFS_VERSION_PREFIX)) return null;
  const match = content.match(/^size (\d+)$/m);
  if (!match) return null;
  return { size: Number(match[1]) };
}
