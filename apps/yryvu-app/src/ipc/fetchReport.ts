// SPDX-License-Identifier: AGPL-3.0-or-later

import type { FetchReport } from "./remote";

/// How a fetch-all should be announced. `severity` maps onto the
/// notification API's tiers.
export interface FetchOutcome {
  severity: "success" | "info" | "error";
  title: string;
  message: string;
}

/// Outcome of a fetch-all, shared by the toolbar button and the
/// sidebar's REMOTE refresh so the two can't drift into telling the
/// user different stories about the same run.
///
/// A partial run is **`info`, not `success`**. There is no warning tier
/// (yryvu ships GK's four severities), and the first cut of #509 tried
/// to squeeze partial into `success` with an honest message — which put
/// a green check above the words "'test' failed" and let the checkmark
/// win the read. A tier that claims nothing is better than one that
/// claims the wrong thing.
///
/// The title always states the count, so it can never contradict the
/// body: that contradiction was the whole complaint.
export function fetchOutcome(report: FetchReport): FetchOutcome {
  const ok = report.succeeded.length;
  const bad = report.failed;
  const total = ok + bad.length;

  if (total === 0) {
    return {
      severity: "info",
      title: "Nothing to fetch",
      message: "This repository has no remotes configured",
    };
  }

  const failures = bad.map((f) => `'${f.remote}': ${f.message}`).join("; ");

  if (bad.length === 0) {
    return {
      severity: "success",
      title: ok === 1 ? `Fetched '${report.succeeded[0]}'` : "Fetched all remotes",
      message: ok === 1 ? "" : `${ok} remotes up to date`,
    };
  }
  if (ok === 0) {
    return {
      severity: "error",
      title:
        total === 1 ? "Fetch failed" : `Fetch failed for all ${total} remotes`,
      message: failures,
    };
  }
  return {
    severity: "info",
    title: `Fetched ${ok} of ${total} remotes`,
    message: `Failed — ${failures}`,
  };
}
