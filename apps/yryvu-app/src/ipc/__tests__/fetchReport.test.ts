// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { fetchReportFailed, fetchReportMessage } from "../fetchReport";
import type { FetchReport } from "../remote";

const report = (
  succeeded: string[],
  failed: { remote: string; message: string }[] = [],
): FetchReport => ({ succeeded, failed });

describe("fetch report messaging (issue #509)", () => {
  it("a partial run is a success that names what failed", () => {
    // The bug: this exact case used to render as "Fetch all failed"
    // with no remote named, while two remotes had in fact fetched.
    const r = report(
      ["ff-remote", "origin-test"],
      [{ remote: "test", message: "unsupported URL protocol" }],
    );
    expect(fetchReportFailed(r)).toBe(false);
    expect(fetchReportMessage(r)).toBe(
      "Fetched 2 of 3 remotes. Failed — 'test': unsupported URL protocol",
    );
  });

  it("names the remote when everything failed", () => {
    const r = report([], [{ remote: "test", message: "boom" }]);
    expect(fetchReportFailed(r)).toBe(true);
    expect(fetchReportMessage(r)).toBe("Fetch failed for 'test': boom");
  });

  it("lists every casualty when all of several failed", () => {
    const r = report(
      [],
      [
        { remote: "a", message: "x" },
        { remote: "b", message: "y" },
      ],
    );
    expect(fetchReportFailed(r)).toBe(true);
    expect(fetchReportMessage(r)).toBe(
      "Fetch failed for all 2 remotes — 'a': x; 'b': y",
    );
  });

  it("names the single remote on a clean single fetch", () => {
    expect(fetchReportMessage(report(["origin"]))).toBe("Fetched 'origin'");
  });

  it("counts them on a clean multi fetch", () => {
    expect(fetchReportMessage(report(["a", "b", "c"]))).toBe(
      "Fetched 3 remotes",
    );
  });

  it("a repo with no remotes is not a failure", () => {
    const r = report([]);
    expect(fetchReportFailed(r)).toBe(false);
    expect(fetchReportMessage(r)).toBe("No remotes configured");
  });
});
