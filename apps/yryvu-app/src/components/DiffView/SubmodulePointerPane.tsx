// SPDX-License-Identifier: AGPL-3.0-or-later

import { createResource, type JSX, Show } from "solid-js";

import { submoduleCommitSummary, type FileDiff } from "../../ipc";
import { setRepoPath } from "../../state";
import { openRepoInAnotherTab } from "../../tabs/ops";

interface SubmodulePointerPaneProps {
  file: FileDiff;
  /// Parent repo path. Absent in the read-only multi-file summary, where
  /// the pane shows bare OIDs without resolving summaries or opening tabs.
  repoPath?: string;
}

function shortOid(sha: string): string {
  return sha.slice(0, 7);
}

/// One old/new pointer row: short OID + lazily-resolved commit summary.
function PointerRow(props: {
  label: string;
  sha: string;
  repoPath?: string;
  submodulePath: string;
}): JSX.Element {
  const [summary] = createResource(
    () => (props.repoPath ? ([props.repoPath, props.sha] as const) : undefined),
    ([repo, sha]) => submoduleCommitSummary(repo, props.submodulePath, sha),
  );
  return (
    <div class="submodule-pane__row">
      <span class="submodule-pane__row-label">{props.label}</span>
      <code class="submodule-pane__oid">{shortOid(props.sha)}</code>
      <Show when={summary()}>
        <span class="submodule-pane__summary">— {summary()}</span>
      </Show>
    </div>
  );
}

/// `fileDataTypes.SUBMODULE` pointer pane (research doc 11). Shows the
/// old/new pinned commit OIDs with their summaries and opens the
/// submodule as its own repo tab. "Show log" opens the same tab — the
/// submodule's graph *is* its log, so yryvu folds the two GK affordances
/// into opening the repo.
export function SubmodulePointerPane(props: SubmodulePointerPaneProps): JSX.Element {
  const oldSha = () => props.file.submodule_old_sha;
  const newSha = () => props.file.submodule_new_sha;
  const innerPath = () =>
    props.repoPath ? `${props.repoPath}/${props.file.path}` : undefined;

  function openSubmodule() {
    const path = innerPath();
    if (!path) return;
    setRepoPath(path);
    void openRepoInAnotherTab(path);
  }

  return (
    <div class="submodule-pane" data-testid="Submodule">
      <div class="submodule-pane__title">
        Submodule: <span class="submodule-pane__name">{props.file.path}</span>
      </div>
      <Show when={oldSha()}>
        <PointerRow
          label="Old commit"
          sha={oldSha()!}
          repoPath={props.repoPath}
          submodulePath={props.file.path}
        />
      </Show>
      <Show when={newSha()}>
        <PointerRow
          label="New commit"
          sha={newSha()!}
          repoPath={props.repoPath}
          submodulePath={props.file.path}
        />
      </Show>
      <Show when={props.repoPath}>
        <div class="submodule-pane__actions">
          <button type="button" class="submodule-pane__btn" onClick={openSubmodule}>
            Open submodule
          </button>
          <button type="button" class="submodule-pane__btn" onClick={openSubmodule}>
            Show log
          </button>
        </div>
      </Show>
    </div>
  );
}
