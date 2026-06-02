// SPDX-License-Identifier: AGPL-3.0-or-later

import { AddRemoteDialog } from "./dialogs/AddRemoteDialog";
import { AnnotateTagDialog } from "./dialogs/AnnotateTagDialog";
import { CheckoutDirtyDialog } from "./dialogs/CheckoutDirtyDialog";
import { CreateDialog } from "./dialogs/CreateDialog";
import { DeleteDialog } from "./dialogs/DeleteDialog";
import { DeleteRemoteDialog } from "./dialogs/DeleteRemoteDialog";
import { DeleteTagDialog } from "./dialogs/DeleteTagDialog";
import { EditRemoteDialog } from "./dialogs/EditRemoteDialog";
import { GitflowFinishDialog } from "./dialogs/GitflowFinishDialog";
import { GitflowStartDialog } from "./dialogs/GitflowStartDialog";
import { MergePickDialog } from "./dialogs/MergePickDialog";
import { MergeResultDialog } from "./dialogs/MergeResultDialog";
import { RemoveRemoteDialog } from "./dialogs/RemoveRemoteDialog";
import { RenameDialog } from "./dialogs/RenameDialog";
import { SetUpstreamDialog } from "./dialogs/SetUpstreamDialog";
import { SubmoduleAddDialog } from "./dialogs/SubmoduleAddDialog";
import { SubmoduleRemoveDialog } from "./dialogs/SubmoduleRemoveDialog";
import type { BranchOps } from "../../branchOps";

/**
 * Renders every branch-related dialog; each one opens itself based on
 * `ops.dialog()`. Only one is visible at a time (dialog state is a tagged
 * union).
 */
export function DialogsHost(props: { ops: BranchOps }) {
  return (
    <>
      <CreateDialog ops={props.ops} />
      <RenameDialog ops={props.ops} />
      <DeleteDialog ops={props.ops} />
      <CheckoutDirtyDialog ops={props.ops} />
      <MergePickDialog ops={props.ops} />
      <MergeResultDialog ops={props.ops} />
      <DeleteRemoteDialog ops={props.ops} />
      <SubmoduleAddDialog ops={props.ops} />
      <SubmoduleRemoveDialog ops={props.ops} />
      <SetUpstreamDialog ops={props.ops} />
      <DeleteTagDialog ops={props.ops} />
      <AnnotateTagDialog ops={props.ops} />
      <AddRemoteDialog ops={props.ops} />
      <EditRemoteDialog ops={props.ops} />
      <RemoveRemoteDialog ops={props.ops} />
      <GitflowStartDialog ops={props.ops} />
      <GitflowFinishDialog ops={props.ops} />
    </>
  );
}
