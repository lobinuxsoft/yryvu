// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import type { TagInfo } from "../../ipc";
import {
  clearHoveredRef,
  navigateToRef,
  setHoveredRef,
} from "../../state";
import { IconTag, IconTagAnnotated } from "../Icons";
import { Tooltip } from "../Tooltip";

export interface TagRowProps {
  tag: TagInfo;
  onContextMenu?: (e: MouseEvent, tag: TagInfo) => void;
}

/// Sidebar row for a single tag. Annotated tags get a distinct icon and a
/// native browser tooltip carrying the annotated message; lightweight tags
/// render only the name. The row hooks into the same hovered-ref signal
/// branches use so the graph can highlight the tag's commit on hover.
export function TagRow(props: TagRowProps) {
  const tooltip = () =>
    props.tag.is_annotated && props.tag.message
      ? props.tag.message
      : undefined;
  return (
    <Tooltip text={tooltip()}>
    <div
      class="sidebar__branch-row sidebar__tag-row"
      data-annotated={props.tag.is_annotated ? "true" : "false"}
      onClick={() => navigateToRef(props.tag.target_sha)}
      onMouseEnter={() =>
        setHoveredRef({ kind: "tag", name: props.tag.name })
      }
      onMouseLeave={clearHoveredRef}
      onContextMenu={(e) => props.onContextMenu?.(e, props.tag)}
    >
      <span class="sidebar__tag-icon">
        <Show when={props.tag.is_annotated} fallback={<IconTag />}>
          <IconTagAnnotated />
        </Show>
      </span>
      <span class="sidebar__branch-name">{props.tag.name}</span>
    </div>
    </Tooltip>
  );
}
