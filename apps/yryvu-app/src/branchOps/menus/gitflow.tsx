// SPDX-License-Identifier: AGPL-3.0-or-later

import type { ContextMenuItem } from "../../components/ContextMenu";
import type { GitflowConfig } from "../../ipc";
import type { MenuDeps } from "./types";

/// Topic branches under `prefix`, full names (e.g. `feature/login`).
function candidatesFor(deps: MenuDeps, prefix: string): string[] {
  const locals = (deps.branchSource() ?? []).filter((b) => b.kind === "local");
  return locals.filter((b) => b.name.startsWith(prefix)).map((b) => b.name);
}

/**
 * GITFLOW section menu (issue #19) — opened from the section header's
 * `+` button. Mirrors GitKraken's GitFlow-Start / GitFlow-Finish groups
 * (feature / release / hotfix). Each Finish entry is disabled when no
 * branch matches its prefix, with a tooltip explaining why.
 *
 * GitHub Flow is intentionally NOT here: it needs no `[gitflow]` config,
 * so it lives in the LOCAL section header menu (see `menus/section`) and
 * stays reachable without initialising Git Flow.
 */
export function buildGitflowMenuItems(deps: MenuDeps): ContextMenuItem[] {
  const cfg = deps.gitflowConfigSource();
  if (!cfg) return [];
  const items: ContextMenuItem[] = [];

  items.push({
    label: "Start feature…",
    onSelect: () => deps.openGitflowStartDialog("feature"),
  });
  items.push({
    label: "Start release…",
    onSelect: () => deps.openGitflowStartDialog("release"),
  });
  items.push({
    label: "Start hotfix…",
    onSelect: () => deps.openGitflowStartDialog("hotfix"),
  });
  items.push({ type: "separator" });

  pushFinish(items, deps, "feature", cfg.featurePrefix);
  pushFinish(items, deps, "release", cfg.releasePrefix);
  pushFinish(items, deps, "hotfix", cfg.hotfixPrefix);

  return items;
}

function pushFinish(
  items: ContextMenuItem[],
  deps: MenuDeps,
  flow: "feature" | "release" | "hotfix",
  prefix: string,
): void {
  const candidates = candidatesFor(deps, prefix);
  items.push({
    label: `Finish ${flow}…`,
    disabled: candidates.length === 0,
    title: candidates.length === 0 ? `No ${prefix}* branches` : undefined,
    onSelect: () => deps.openGitflowFinishDialog(flow, candidates),
  });
}

export function openGitflowMenu(deps: MenuDeps, e: MouseEvent) {
  e.preventDefault();
  deps.setMenu({
    x: e.clientX,
    y: e.clientY,
    items: buildGitflowMenuItems(deps),
  });
}

/// GitHub Flow entries appended to the LOCAL section header menu. Always
/// available (no config needed); `base` defaults to the production
/// branch when gitflow is configured, otherwise the first `main`/
/// `master`/HEAD candidate the caller resolves.
export function buildGithubFlowMenuItems(
  deps: MenuDeps,
  base: string,
): ContextMenuItem[] {
  const locals = (deps.branchSource() ?? []).filter((b) => b.kind === "local");
  const finishCandidates = locals
    .map((b) => b.name)
    .filter((n) => n !== base);
  return [
    {
      label: "Start branch (GitHub Flow)…",
      onSelect: () => deps.openGitflowStartDialog("github", base),
    },
    {
      label: "Finish branch (GitHub Flow)…",
      disabled: finishCandidates.length === 0,
      onSelect: () =>
        deps.openGitflowFinishDialog("github", finishCandidates, base),
    },
  ];
}

/// The finish dialog shows full branch names (`feature/login`) but the
/// Git Flow backend ops take the bare name/version (`login`). GitHub
/// Flow passes the full name and never hits this. The prefix is
/// everything up to and including the last `/`.
export function stripPrefix(branch: string): string {
  const slash = branch.lastIndexOf("/");
  return slash >= 0 ? branch.slice(slash + 1) : branch;
}

/// Resolve the GitHub Flow base branch: the configured production
/// branch when gitflow is initialised, else `main` / `master` / the
/// first local branch.
export function resolveGithubFlowBase(
  cfg: GitflowConfig | null,
  localNames: string[],
): string {
  if (cfg && localNames.includes(cfg.masterBranch)) return cfg.masterBranch;
  for (const candidate of ["main", "master"]) {
    if (localNames.includes(candidate)) return candidate;
  }
  return localNames[0] ?? "main";
}
