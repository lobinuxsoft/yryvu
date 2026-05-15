// SPDX-License-Identifier: AGPL-3.0-or-later

import type { PullRequestDetail } from "../../ipc";
import { activePrDetail } from "../../state/pr-detail";
import { MergeFormCanonical } from "./MergeFormCanonical";
import { MergeFormGitlab } from "./MergeFormGitlab";

interface MergeFormProps {
  detail: PullRequestDetail;
  onClose: () => void;
}

/// Dispatcher: pick the GitLab-specific body for `gitlab` /
/// `gitlabSelfHosted` integrations, the canonical 3-radio body for
/// the rest (GitHub + Gitea). Provider detection routes through the
/// active PR detail ref so future providers can be plugged in by
/// adding another branch here.
function isGitlab(integrationType: string | undefined): boolean {
  return (
    integrationType === "gitlab" || integrationType === "gitlabSelfHosted"
  );
}

export function MergeForm(props: MergeFormProps) {
  const integrationType = activePrDetail()?.integrationType;
  if (isGitlab(integrationType)) {
    return <MergeFormGitlab detail={props.detail} onClose={props.onClose} />;
  }
  return <MergeFormCanonical detail={props.detail} onClose={props.onClose} />;
}
