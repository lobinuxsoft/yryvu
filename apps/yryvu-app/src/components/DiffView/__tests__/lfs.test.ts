// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { parseLfsPointer } from "../lfs";

describe("parseLfsPointer", () => {
  it("parses a well-formed pointer's size", () => {
    const pointer =
      "version https://git-lfs.github.com/spec/v1\n" +
      "oid sha256:4d7a214614ab2935c943f9e0ff69d22eadbb8f32b1258daaa5e2ca24d17e2393\n" +
      "size 12345\n";
    expect(parseLfsPointer(pointer)).toEqual({ size: 12345 });
  });

  it("returns null for ordinary content", () => {
    expect(parseLfsPointer("# A normal markdown file\n")).toBeNull();
    expect(parseLfsPointer("")).toBeNull();
  });

  it("returns null when the version line is present but size is missing", () => {
    const pointer =
      "version https://git-lfs.github.com/spec/v1\noid sha256:abc\n";
    expect(parseLfsPointer(pointer)).toBeNull();
  });
});
