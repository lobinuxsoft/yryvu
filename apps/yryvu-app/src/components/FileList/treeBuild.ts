// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FileDiffMeta } from "../../ipc/diff";

/// A leaf carries the full `FileDiffMeta` so the renderer can show status + stats
/// without a second lookup. `name` is the basename (used in tree mode);
/// `path` is the full repo-root-relative path (used in flat mode / tooltips).
export interface FileNode {
  kind: "file";
  name: string;
  path: string;
  data: FileDiffMeta;
}

/// Directory node. `path` is the repo-root-relative path of the dir itself
/// (no trailing slash). Children are emitted pre-sorted (dirs first alpha,
/// then files alpha) so the renderer can iterate without re-sorting.
export interface DirNode {
  kind: "dir";
  name: string;
  path: string;
  children: TreeNode[];
}

export type TreeNode = DirNode | FileNode;

/// Builds a sorted tree of `TreeNode`s from a flat list of `FileDiffMeta`s.
///
/// Insert uses `Map<name, node>` per level for **O(depth)** per path — the
/// previous `.find()` on arrays was O(depth · siblings) and choked on
/// working trees with hundreds of files. 1:1 port of GitKraken's
/// `_insertPathIntoTree`, which uses object-keyed children for the same
/// reason.
/// Sort direction shared by both render modes. GitKraken's comparator
/// (`makeGetFileList`, bundle 5537500) is `_.sortBy(f => _.toLower(f.path))`
/// optionally passed through `_.reverse` — a single key, two directions.
/// In tree mode the reversal applies to directory order as well as file
/// order, so a descending list reads bottom-up at every depth.
export function buildTreeFromPaths(
  files: FileDiffMeta[],
  descending = false,
): TreeNode[] {
  interface MutDir {
    name: string;
    path: string;
    dirs: Map<string, MutDir>;
    files: FileNode[];
  }
  const root: MutDir = { name: "", path: "", dirs: new Map(), files: [] };

  for (const file of files) {
    const segments = file.path.split("/").filter((s) => s.length > 0);
    if (segments.length === 0) continue;

    let cursor = root;
    for (let i = 0; i < segments.length - 1; i++) {
      const segment = segments[i]!;
      let child = cursor.dirs.get(segment);
      if (!child) {
        const childPath = cursor.path ? `${cursor.path}/${segment}` : segment;
        child = { name: segment, path: childPath, dirs: new Map(), files: [] };
        cursor.dirs.set(segment, child);
      }
      cursor = child;
    }
    const name = segments[segments.length - 1]!;
    cursor.files.push({ kind: "file", name, path: file.path, data: file });
  }

  return freezeDir(root, descending ? -1 : 1);
}

function freezeDir(
  dir: {
    dirs: Map<string, any>;
    files: FileNode[];
  },
  order: 1 | -1,
): TreeNode[] {
  const out: TreeNode[] = [];
  const dirNames = [...dir.dirs.keys()].sort(
    (a, b) => order * a.localeCompare(b),
  );
  for (const name of dirNames) {
    const child = dir.dirs.get(name)!;
    out.push({
      kind: "dir",
      name: child.name,
      path: child.path,
      children: freezeDir(child, order),
    });
  }
  dir.files.sort((a, b) => order * a.name.localeCompare(b.name));
  for (const f of dir.files) out.push(f);
  return out;
}

/// Pre-flattened row ready for virtualized rendering. GitKraken equivalent:
/// `getFlattenedViewFromFileTree`. The renderer slices by the current
/// scroll window — one DOM node per visible row, not per file in the
/// repo.
export type FlatRow =
  | { kind: "file"; path: string; depth: number; label: string; data: FileDiffMeta }
  | { kind: "dir"; path: string; depth: number; name: string };

/// Produces the visible flat row list in tree mode. A dir contributes its
/// own row plus (when expanded) its descendants' rows. A subtree with no
/// filter-matching descendants is pruned entirely — the dir row itself
/// disappears, matching GK's pruned tree behavior.
export function flattenTree(
  nodes: TreeNode[],
  isDirExpanded: (dirPath: string) => boolean,
  isFileVisible: (path: string) => boolean,
): FlatRow[] {
  const out: FlatRow[] = [];
  const walk = (list: TreeNode[], depth: number) => {
    for (const node of list) {
      if (node.kind === "file") {
        if (isFileVisible(node.path)) {
          out.push({
            kind: "file",
            path: node.path,
            depth,
            label: node.name,
            data: node.data,
          });
        }
        continue;
      }
      const dirStart = out.length;
      out.push({ kind: "dir", path: node.path, depth, name: node.name });
      const expanded = isDirExpanded(node.path);
      if (expanded) {
        walk(node.children, depth + 1);
        if (out.length === dirStart + 1 && !anyFileVisible(node.children, isFileVisible)) {
          // Dir expanded but no children produced rows AND no descendant
          // matches the filter → prune the dir row entirely.
          out.length = dirStart;
        }
      } else if (!anyFileVisible(node.children, isFileVisible)) {
        out.length = dirStart;
      }
    }
  };
  walk(nodes, 0);
  return out;
}

function anyFileVisible(
  nodes: TreeNode[],
  isFileVisible: (path: string) => boolean,
): boolean {
  for (const node of nodes) {
    if (node.kind === "file") {
      if (isFileVisible(node.path)) return true;
    } else if (anyFileVisible(node.children, isFileVisible)) {
      return true;
    }
  }
  return false;
}

/// Flat-mode rendering helper — produces the same `FlatRow` shape as tree
/// mode but with `depth=0` for every file, sorted by full path.
export function flattenFlat(
  files: FileDiffMeta[],
  isFileVisible: (path: string) => boolean,
  descending = false,
): FlatRow[] {
  const order = descending ? -1 : 1;
  const visible = files.filter((f) => isFileVisible(f.path));
  visible.sort((a, b) => order * a.path.localeCompare(b.path));
  return visible.map((f) => ({
    kind: "file" as const,
    path: f.path,
    depth: 0,
    label: f.path,
    data: f,
  }));
}

/// Returns the set of ancestor directory paths for any file in `files` whose
/// full path contains `query` (case-insensitive substring). Used to
/// auto-expand filter matches — matches the `TreeViewFileForcedVisible`
/// semantics of GitKraken.
export function ancestorPathsForMatches(
  files: FileDiffMeta[],
  query: string,
): Set<string> {
  const needle = query.trim().toLowerCase();
  const out = new Set<string>();
  if (needle.length === 0) return out;
  for (const file of files) {
    if (!file.path.toLowerCase().includes(needle)) continue;
    const segments = file.path.split("/").filter((s) => s.length > 0);
    let accum = "";
    for (let i = 0; i < segments.length - 1; i++) {
      accum = accum ? `${accum}/${segments[i]}` : segments[i]!;
      out.add(accum);
    }
  }
  return out;
}

/// Predicate used by the renderer: should this file be visible given the
/// current filter? Empty query = always visible.
export function fileMatchesFilter(path: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return true;
  return path.toLowerCase().includes(needle);
}

/// Collects every dir path in the tree, for Collapse All.
export function collectDirPaths(nodes: TreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.kind !== "dir") continue;
      out.push(node.path);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}
