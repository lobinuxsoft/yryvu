// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import type { CloneRepoCandidate } from "../../../../ipc";
import type { IntegrationState } from "../../../PreferencesWindow/panels/Integrations/state";
import type { ProviderInfo } from "../../../PreferencesWindow/panels/Integrations/providerTable";
import {
  filterCandidates,
  groupCandidates,
  renderModeFor,
} from "../cloneFromProvider.helpers";

function provider(type: ProviderInfo["type"]): ProviderInfo {
  return {
    type,
    label: type,
    verboseLabel: type,
    hostnameLabel: type,
    hostname: null,
    roles: ["HOSTING_SERVICE"],
    authType: "OAUTH",
    isSelfHosted: false,
    initials: "X",
    colorAccent: "#000",
    cohort: "v1",
    prCharacter: "#",
    tokenGenPath: null,
    tokenGenParams: null,
    tokenIsAppPassword: false,
  };
}

function candidate(
  owner: string,
  ownerKind: "user" | "organization",
  name: string,
  isPrivate = false,
): CloneRepoCandidate {
  return {
    owner,
    ownerKind,
    name,
    fullName: `${owner}/${name}`,
    cloneUrlHttps: `https://example.com/${owner}/${name}.git`,
    isPrivate,
  };
}

describe("renderModeFor", () => {
  it("forces backendPending for Bitbucket / Bitbucket DC / Azure regardless of state", () => {
    const connected: IntegrationState = {
      tag: "connected",
      user: { displayName: "x", login: "x" },
    };
    expect(renderModeFor(provider("bitbucket"), connected).kind).toBe("backendPending");
    expect(renderModeFor(provider("bitbucketServer"), connected).kind).toBe("backendPending");
    expect(renderModeFor(provider("azureDevops"), connected).kind).toBe("backendPending");
  });

  it("returns connected when integration tag is connected for backed providers", () => {
    const connected: IntegrationState = {
      tag: "connected",
      user: { displayName: "x", login: "x" },
    };
    for (const t of ["github", "githubEnterprise", "gitlab", "gitlabSelfHosted", "gitea", "giteaSelfHosted"] as const) {
      expect(renderModeFor(provider(t), connected).kind).toBe("connected");
    }
  });

  it("returns notConnected when state.tag is disconnected", () => {
    expect(renderModeFor(provider("github"), { tag: "disconnected" }).kind).toBe("notConnected");
  });

  it("returns connecting for connecting + disconnecting transitional states", () => {
    expect(renderModeFor(provider("github"), { tag: "connecting" }).kind).toBe("connecting");
    expect(renderModeFor(provider("github"), { tag: "disconnecting" }).kind).toBe("connecting");
  });
});

describe("groupCandidates", () => {
  it("places personal repos first under a Your repos header", () => {
    const groups = groupCandidates([
      candidate("acme", "organization", "infra"),
      candidate("alice", "user", "yryvu"),
    ]);
    expect(groups[0].isPersonal).toBe(true);
    expect(groups[0].headerLabel).toBe("Your repos");
    expect(groups[0].rows.map((r) => r.name)).toEqual(["yryvu"]);
  });

  it("uppercases organization headers and sorts orgs alphabetically", () => {
    const groups = groupCandidates([
      candidate("zeta", "organization", "z"),
      candidate("acme", "organization", "a"),
    ]);
    expect(groups.map((g) => g.headerLabel)).toEqual(["ACME", "ZETA"]);
  });

  it("sorts repos alphabetically within each owner group", () => {
    const groups = groupCandidates([
      candidate("alice", "user", "zeta"),
      candidate("alice", "user", "alpha"),
      candidate("alice", "user", "delta"),
    ]);
    expect(groups[0].rows.map((r) => r.name)).toEqual(["alpha", "delta", "zeta"]);
  });

  it("omits the personal section entirely when no personal repos exist", () => {
    const groups = groupCandidates([candidate("acme", "organization", "infra")]);
    expect(groups.length).toBe(1);
    expect(groups[0].isPersonal).toBe(false);
  });
});

describe("filterCandidates", () => {
  const all = [
    candidate("alice", "user", "yryvu"),
    candidate("acme", "organization", "infra"),
    candidate("acme", "organization", "platform"),
  ];

  it("returns input unchanged for empty query", () => {
    expect(filterCandidates(all, "")).toHaveLength(3);
    expect(filterCandidates(all, "   ")).toHaveLength(3);
  });

  it("matches case-insensitively against fullName + name", () => {
    expect(filterCandidates(all, "PLATF").map((c) => c.name)).toEqual(["platform"]);
    expect(filterCandidates(all, "alice").map((c) => c.name)).toEqual(["yryvu"]);
  });

  it("returns empty when nothing matches", () => {
    expect(filterCandidates(all, "nonexistent")).toEqual([]);
  });
});
