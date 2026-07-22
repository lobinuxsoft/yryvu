// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FetchReport } from "./remote";

/// Human-readable outcome of a fetch-all, shared by the toolbar button
/// and the sidebar's REMOTE refresh so the two can't drift into telling
/// the user different stories about the same run.
///
/// Honesty is the whole point of #509: the old code reported "Fetch all
/// failed" whenever any remote failed, even when the others had already
/// fetched — and it never named the one at fault.
export function fetchReportMessage(report: FetchReport): string {
  const ok = report.succeeded.length;
  const bad = report.failed;

  if (ok === 0 && bad.length === 0) return "No remotes configured";

  const failures = bad
    .map((f) => `'${f.remote}': ${f.message}`)
    .join("; ");

  if (bad.length === 0) {
    return ok === 1
      ? `Fetched '${report.succeeded[0]}'`
      : `Fetched ${ok} remotes`;
  }
  if (ok === 0) {
    return bad.length === 1
      ? `Fetch failed for ${failures}`
      : `Fetch failed for all ${bad.length} remotes — ${failures}`;
  }
  return `Fetched ${ok} of ${ok + bad.length} remotes. Failed — ${failures}`;
}

/// A run is a failure only when nothing at all was fetched. A partial
/// run is reported as a success whose message names the casualties:
/// the refs that did arrive are real and the user should see them, and
/// yryvu's toast severities are GK's four with no warning tier.
export function fetchReportFailed(report: FetchReport): boolean {
  return report.succeeded.length === 0 && report.failed.length > 0;
}
