// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CombinedDiffKind } from "../../../ipc/diff";

/**
 * Header copy for the inspector when the selection is anything but a
 * single commit. 1:1 with GitKraken's `CommitDetailPanel` strings per
 * `docs/research/gitkraken-right-panel/`:
 *
 *   - `CommitDetailPanel-DiffBetweenCommitsTitle` ("Viewing merged diff
 *     of {N} commits") → kind = "multi".
 *   - `CommitDetailPanel-DiffBetweenACommitAndTheWIP` ("Viewing diff
 *     between a commit and the WIP") → kind = "commit-vs-wip".
 *
 * The other two variants (`multi-vs-wip`, `wip-only`) don't have direct
 * GK string keys but follow the same idiom — they exist because chajá
 * keeps the WIP in the same selection model as committed rows, so the
 * WIP-only case can render through the inspector's `details` mode rather
 * than forcing a switch back to the staging composer.
 *
 * The `single` kind is included for type completeness; it should never
 * reach this component (the single-commit branch in `CommitDetails`
 * renders the full HeaderBlock/MessageBlock/AuthorBlock instead).
 */
export function MultiSelectHeader(props: {
  kind: CombinedDiffKind;
  nCommits: number;
}) {
  const text = (): string => {
    switch (props.kind) {
      case "multi":
        return `Viewing merged diff of ${props.nCommits} commits`;
      case "commit-vs-wip":
        return "Viewing diff between a commit and the WIP";
      case "multi-vs-wip":
        return `Viewing merged diff of ${props.nCommits} commits and the WIP`;
      case "wip-only":
        return "Viewing diff against the WIP";
      case "single":
        return "";
    }
  };
  return (
    <div class="commit-detail__multi-header" data-testid="commit-detail-multi-header">
      <p>{text()}</p>
    </div>
  );
}
