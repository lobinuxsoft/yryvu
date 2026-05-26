// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { parentDir, RECENTLY_OPENED_LIMIT, relativeTime } from "../helpers";

describe("relativeTime", () => {
  const now = 1_700_000_000_000;

  it("returns 'just now' for under a minute", () => {
    expect(relativeTime(now - 5_000, now)).toBe("just now");
    expect(relativeTime(now - 59_000, now)).toBe("just now");
  });

  it("returns minutes for under an hour", () => {
    expect(relativeTime(now - 60_000, now)).toBe("1m ago");
    expect(relativeTime(now - 30 * 60_000, now)).toBe("30m ago");
  });

  it("returns hours for under a day", () => {
    expect(relativeTime(now - 60 * 60_000, now)).toBe("1h ago");
    expect(relativeTime(now - 5 * 60 * 60_000, now)).toBe("5h ago");
  });

  it("returns days for under 30 days", () => {
    expect(relativeTime(now - 24 * 60 * 60_000, now)).toBe("1d ago");
    expect(relativeTime(now - 7 * 24 * 60 * 60_000, now)).toBe("7d ago");
  });

  it("falls back to localeDateString past 30 days", () => {
    const old = now - 60 * 24 * 60 * 60_000;
    expect(relativeTime(old, now)).toBe(new Date(old).toLocaleDateString());
  });
});

describe("RECENTLY_OPENED_LIMIT", () => {
  it("is the verbatim GK bundle constant (8)", () => {
    expect(RECENTLY_OPENED_LIMIT).toBe(8);
  });
});

describe("parentDir", () => {
  it("strips the last segment of a POSIX path", () => {
    expect(parentDir("/foo/bar/repo")).toBe("/foo/bar");
    expect(parentDir("/home/user/code/yryvu")).toBe("/home/user/code");
  });

  it("returns '/' for root-level entries", () => {
    expect(parentDir("/repo")).toBe("/");
  });

  it("returns '' for bare names without separators", () => {
    expect(parentDir("repo")).toBe("");
  });
});
