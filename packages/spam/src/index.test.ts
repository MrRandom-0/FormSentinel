import { describe, expect, it } from "vitest";
import { deterministicSpam } from "./index";
describe("deterministic spam", () => {
  it("explains deterministic signals", () => {
    const result = deterministicSpam({
      payload: { message: "buy now http://a http://b http://c http://d http://e" },
      honeypotField: "fax",
      blockedPhrases: ["buy now"],
      userAgent: "curl",
    });
    expect(result.verdict).toBe("block");
    expect(result.reasons).toContain("blocked_phrase");
    expect(result.reasons).toContain("excessive_links");
  });
  it("allows ordinary content", () =>
    expect(
      deterministicSpam({
        payload: { message: "Hello" },
        honeypotField: "fax",
        userAgent: "Mozilla/5.0",
      }).verdict,
    ).toBe("allow"));
});
