// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Preference section registry. 1:1 mapping to GitKraken's
 * `labelAndIconByTabType` (`render.bundle.js` ~3424765), filtered against
 * the chajá coverage matrix in #136. Each entry maps a `PreferenceSectionId`
 * to a label, an icon, and a panel component that lazy-renders when the
 * section is active.
 *
 * Panels with a tracking issue have their `issue` field set so the
 * Placeholder panel can link back to it.
 */

import type { JSX } from "solid-js";
import type { PreferenceSectionId } from "../../state";
import {
  IconAlertCircle,
  IconArchive,
  IconBell,
  IconBranch,
  IconCode,
  IconCodeCommit,
  IconFilter,
  IconFlask,
  IconGear,
  IconKey,
  IconLayers,
  IconListOl,
  IconPalette,
  IconPlug,
  IconPuzzle,
  IconTerminal,
  IconText,
  IconTools,
  IconUsers,
} from "../Icons";
import { Placeholder } from "./panels/Placeholder";
import { GeneralPanel } from "./panels/General";
import { UiPanel } from "./panels/Ui";
import { ExperimentalPanel } from "./panels/Experimental";
import { IntegrationsPanel } from "./panels/Integrations";
import { NotificationsPanel } from "./panels/Notifications";

export interface SectionDef {
  id: PreferenceSectionId;
  label: string;
  icon: () => JSX.Element;
  panel: () => JSX.Element;
  /** Tracking issue, surfaced by the Placeholder panel. */
  issue?: number;
}

export const SECTIONS: readonly SectionDef[] = [
  { id: "general", label: "General", icon: IconGear, panel: GeneralPanel, issue: 102 },
  { id: "ui", label: "UI", icon: IconPalette, panel: UiPanel, issue: 103 },
  {
    id: "commit",
    label: "Commit",
    icon: IconCodeCommit,
    panel: () => Placeholder({ section: "Commit", issue: 3 }),
    issue: 3,
  },
  {
    id: "editor",
    label: "Editor",
    icon: IconCode,
    panel: () => Placeholder({ section: "Editor" }),
  },
  {
    id: "encoding",
    label: "Encoding",
    icon: IconText,
    panel: () => Placeholder({ section: "Encoding" }),
  },
  {
    id: "conflict_detection",
    label: "Conflict detection",
    icon: IconAlertCircle,
    panel: () => Placeholder({ section: "Conflict detection", issue: 106 }),
    issue: 106,
  },
  {
    id: "experimental",
    label: "Experimental",
    icon: IconFlask,
    panel: ExperimentalPanel,
    issue: 107,
  },
  {
    id: "gpg",
    label: "GPG",
    icon: IconKey,
    panel: () => Placeholder({ section: "GPG", issue: 104 }),
    issue: 104,
  },
  {
    id: "gitflow",
    label: "Git Flow",
    icon: IconBranch,
    panel: () => Placeholder({ section: "Git Flow", issue: 19 }),
    issue: 19,
  },
  {
    id: "githooks",
    label: "Git hooks",
    icon: IconPlug,
    panel: () => Placeholder({ section: "Git hooks" }),
  },
  {
    id: "integrations",
    label: "Integrations",
    icon: IconPuzzle,
    panel: IntegrationsPanel,
    issue: 242,
  },
  {
    id: "issue_tracker",
    label: "Issue tracker",
    icon: IconListOl,
    panel: () => Placeholder({ section: "Issue tracker", issue: 97 }),
    issue: 97,
  },
  {
    id: "lfs",
    label: "Git LFS",
    icon: IconArchive,
    panel: () => Placeholder({ section: "Git LFS", issue: 21 }),
    issue: 21,
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: IconBell,
    panel: NotificationsPanel,
    issue: 193,
  },
  {
    id: "profiles",
    label: "Profiles",
    icon: IconUsers,
    panel: () => Placeholder({ section: "Profiles" }),
  },
  {
    id: "sparse_checkout",
    label: "Sparse checkout",
    icon: IconFilter,
    panel: () => Placeholder({ section: "Sparse checkout" }),
  },
  {
    id: "ssh",
    label: "SSH",
    icon: IconTerminal,
    panel: () => Placeholder({ section: "SSH", issue: 47 }),
    issue: 47,
  },
  {
    id: "submodules",
    label: "Submodules",
    icon: IconLayers,
    panel: () => Placeholder({ section: "Submodules", issue: 98 }),
    issue: 98,
  },
  {
    id: "tools",
    label: "External tools",
    icon: IconTools,
    panel: () => Placeholder({ section: "External tools", issue: 105 }),
    issue: 105,
  },
];

export function findSection(id: PreferenceSectionId): SectionDef {
  const found = SECTIONS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown preference section: ${id}`);
  return found;
}
