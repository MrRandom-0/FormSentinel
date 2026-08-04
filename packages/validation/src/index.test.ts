import { describe, expect, it } from "vitest";
import { safeUrl } from "./index";
describe("safe URL", () => {
  it("allows HTTP(S) and rejects executable schemes", () => {
    expect(safeUrl.parse("https://example.test/path")).toBe("https://example.test/path");
    expect(() => safeUrl.parse("javascript:alert(1)")).toThrow();
  });
});
