// SPDX-License-Identifier: AGPL-3.0-or-later

import { Show } from "solid-js";

import type { TagInfo } from "../../ipc";
import { clearHoveredRef, setHoveredRef } from "../../state";
import { IconTag, IconTagAnnotated } from "../Icons";

export interface TagRowProps {
  tag: TagInfo;
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
    <div
      class="sidebar__branch-row sidebar__tag-row"
      data-annotated={props.tag.is_annotated ? "true" : "false"}
      title={tooltip()}
      onMouseEnter={() =>
        setHoveredRef({ kind: "tag", name: props.tag.name })
      }
      onMouseLeave={clearHoveredRef}
    >
      <span class="sidebar__tag-icon">
        <Show when={props.tag.is_annotated} fallback={<IconTag />}>
          <IconTagAnnotated />
        </Show>
      </span>
      <span class="sidebar__branch-name">{props.tag.name}</span>
    </div>
  );
}
