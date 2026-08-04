import { describe, expect, it } from "vitest";
import { httpSecurityHeaders, trustedRequestHost, validCsrfOrigin } from "./index";

describe("Phase 4 HTTP security", () => {
  it("sets production browser defenses", () => {
    const headers = httpSecurityHeaders(true);
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["strict-transport-security"]).toContain("includeSubDomains");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["permissions-policy"]).not.toContain("*");
  });
  it("matches trusted hosts exactly", () => {
    expect(trustedRequestHost("app.example.test", ["app.example.test"])).toBe(true);
    expect(trustedRequestHost("app.example.test.evil", ["app.example.test"])).toBe(false);
  });
  it("requires an exact CSRF origin", () => {
    expect(validCsrfOrigin("https://app.example.test", "https://app.example.test/path")).toBe(true);
    expect(validCsrfOrigin("https://evil.example.test", "https://app.example.test")).toBe(false);
    expect(validCsrfOrigin(null, "https://app.example.test")).toBe(false);
  });
});
