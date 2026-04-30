// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckoutDirtyDialog } from "./dialogs/CheckoutDirtyDialog";
import { CreateDialog } from "./dialogs/CreateDialog";
import { DeleteDialog } from "./dialogs/DeleteDialog";
import { DeleteRemoteDialog } from "./dialogs/DeleteRemoteDialog";
import { MergePickDialog } from "./dialogs/MergePickDialog";
import { MergeResultDialog } from "./dialogs/MergeResultDialog";
import { RenameDialog } from "./dialogs/RenameDialog";
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
    </>
  );
}
