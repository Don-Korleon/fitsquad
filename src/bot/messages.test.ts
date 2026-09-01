import { describe, expect, it } from "vitest";
import { escapeMd } from "./messages.js";

describe("escapeMd", () => {
  it("escapes every Telegram Markdown special character", () => {
    const specials = "_*[]()~`>#+-=|{}.!\\";
    for (const ch of specials) {
      expect(escapeMd(ch)).toBe(`\\${ch}`);
    }
  });

  it("leaves plain text untouched", () => {
    expect(escapeMd("Burn Crew 2026")).toBe("Burn Crew 2026");
  });

  it("neutralizes an attempted formatting/link injection in a team name", () => {
    const malicious = "*bold*[click me](https://evil.example)";
    const escaped = escapeMd(malicious);
    // The raw, parseable Markdown link syntax must not survive escaping.
    expect(escaped).not.toContain("[click me](https://evil.example)");
    expect(escaped).toContain("\\[click me\\]");
    expect(escaped).toContain("\\(https://evil");
  });
});
