// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { fetchOutcome } from "../fetchReport";
import type { FetchReport } from "../remote";

const report = (
  succeeded: string[],
  failed: { remote: string; message: string }[] = [],
): FetchReport => ({ succeeded, failed });

describe("fetch outcome (issue #509)", () => {
  it("a partial run is neither success nor failure", () => {
    // Two defects in one case. Originally this rendered as
    // "Fetch all failed" while two remotes had in fact fetched; the
    // first fix made the body honest but left the title claiming
    // "Fetched all remotes", so a green check sat above the words
    // "'test' failed" and won the read.
    const outcome = fetchOutcome(
      report(
        ["ff-remote", "origin-test"],
        [{ remote: "test", message: "unsupported URL protocol" }],
      ),
    );
    expect(outcome.severity).toBe("info");
    expect(outcome.title).toBe("Fetched 2 of 3 remotes");
    expect(outcome.message).toBe("Failed — 'test': unsupported URL protocol");
  });

  it("never lets the title contradict the body", () => {
    // The invariant behind the fix: whenever anything failed, the title
    // must not claim completeness.
    const outcome = fetchOutcome(
      report(["a"], [{ remote: "b", message: "boom" }]),
    );
    expect(outcome.title).not.toMatch(/\ball\b/i);
    expect(outcome.title).toContain("1 of 2");
  });

  it("everything failing is an error that names the remote", () => {
    const outcome = fetchOutcome(report([], [{ remote: "test", message: "boom" }]));
    expect(outcome.severity).toBe("error");
    expect(outcome.title).toBe("Fetch failed");
    expect(outcome.message).toBe("'test': boom");
  });

  it("lists every casualty when all of several failed", () => {
    const outcome = fetchOutcome(
      report(
        [],
        [
          { remote: "a", message: "x" },
          { remote: "b", message: "y" },
        ],
      ),
    );
    expect(outcome.severity).toBe("error");
    expect(outcome.title).toBe("Fetch failed for all 2 remotes");
    expect(outcome.message).toBe("'a': x; 'b': y");
  });

  it("a clean run is the only success", () => {
    const outcome = fetchOutcome(report(["a", "b", "c"]));
    expect(outcome.severity).toBe("success");
    expect(outcome.title).toBe("Fetched all remotes");
    expect(outcome.message).toBe("3 remotes up to date");
  });

  it("names the single remote on a clean single fetch", () => {
    const outcome = fetchOutcome(report(["origin"]));
    expect(outcome.severity).toBe("success");
    expect(outcome.title).toBe("Fetched 'origin'");
  });

  it("a repo with no remotes is informational, not a failure", () => {
    const outcome = fetchOutcome(report([]));
    expect(outcome.severity).toBe("info");
    expect(outcome.title).toBe("Nothing to fetch");
  });
});
