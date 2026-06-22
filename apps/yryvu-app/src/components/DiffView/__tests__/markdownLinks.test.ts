// SPDX-License-Identifier: AGPL-3.0-or-later

import { describe, expect, it } from "vitest";

import { classifyLink } from "../markdownLinks";

describe("classifyLink (markdown preview link security)", () => {
  it("treats anchors and empty hrefs as in-document", () => {
    expect(classifyLink("")).toBe("anchor");
    expect(classifyLink("#heading")).toBe("anchor");
  });

  it("opens http/https/mailto externally", () => {
    expect(classifyLink("https://example.com")).toBe("external");
    expect(classifyLink("http://example.com/path")).toBe("external");
    expect(classifyLink("HTTPS://EXAMPLE.COM")).toBe("external");
    expect(classifyLink("mailto:a@b.com")).toBe("external");
  });

  it("blocks local files and relative paths", () => {
    expect(classifyLink("file:///etc/passwd")).toBe("blocked");
    expect(classifyLink("../../secret.txt")).toBe("blocked");
    expect(classifyLink("./notes.md")).toBe("blocked");
    expect(classifyLink("/usr/local/bin")).toBe("blocked");
  });
});
