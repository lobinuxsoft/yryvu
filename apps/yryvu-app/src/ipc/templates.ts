// SPDX-License-Identifier: AGPL-3.0-or-later

import { invoke } from "@tauri-apps/api/core";

/// Mirrors `yryvu_bridge::templates::TemplateInfo`. Wire format is
/// camelCase per the backend's `serde(rename_all = "camelCase")`.
export interface TemplateInfo {
  name: string;
  displayLabel: string;
}

export async function listGitignoreTemplates(): Promise<TemplateInfo[]> {
  return invoke<TemplateInfo[]>("list_gitignore_templates");
}

export async function listLicenseTemplates(): Promise<TemplateInfo[]> {
  return invoke<TemplateInfo[]>("list_license_templates");
}
