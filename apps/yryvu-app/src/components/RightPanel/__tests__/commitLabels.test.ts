// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { commitButtonLabel } from "../commitLabels";

describe("commit button label (issue #151 item E)", () => {
  it("asks for files before it asks for a message", () => {
    // GK evaluates the staged-files branch first (bundle 7570400): an
    // untouched panel says what to do next, not what is missing from a
    // form the user hasn't reached yet.
    expect(
      commitButtonLabel({ stagedCount: 0, amending: false, hasMessage: false }),
    ).toBe("Stage Changes to Commit");
  });

  it("asks for a message once something is staged", () => {
    expect(
      commitButtonLabel({ stagedCount: 2, amending: false, hasMessage: false }),
    ).toBe("Type a Message to Commit");
  });

  it("singularises one file", () => {
    expect(
      commitButtonLabel({ stagedCount: 1, amending: false, hasMessage: true }),
    ).toBe("Commit Changes to 1 File");
  });

  it("pluralises the rest", () => {
    expect(
      commitButtonLabel({ stagedCount: 7, amending: false, hasMessage: true }),
    ).toBe("Commit Changes to 7 Files");
  });

  it("amending reads as amend regardless of the staged count", () => {
    for (const stagedCount of [0, 1, 5]) {
      expect(
        commitButtonLabel({ stagedCount, amending: true, hasMessage: true }),
      ).toBe("Amend Previous Commit");
    }
  });

  it("amending with no message still asks for one", () => {
    // Amend skips the staged-files gate — a message-only amend is legal —
    // so the message branch is the one that must catch it.
    expect(
      commitButtonLabel({ stagedCount: 0, amending: true, hasMessage: false }),
    ).toBe("Type a Message to Commit");
  });
});
