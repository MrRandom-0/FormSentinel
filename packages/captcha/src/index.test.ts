import { describe, expect, it } from "vitest";
import { DevelopmentCaptchaVerifier, TurnstileVerifier } from "./index";
describe("CAPTCHA", () => {
  it("forbids development verifier in production", () =>
    expect(() => new DevelopmentCaptchaVerifier("production")).toThrow());
  it("uses explicit development tokens", async () => {
    const verifier = new DevelopmentCaptchaVerifier("test");
    expect((await verifier.verify("formsentinel-test-pass")).success).toBe(true);
    expect((await verifier.verify("bad")).success).toBe(false);
  });
  it("handles provider unavailability", async () => {
    const verifier = new TurnstileVerifier("secret", async () => {
      throw new Error("offline");
    });
    expect(await verifier.verify("token")).toEqual({
      success: false,
      errorCodes: ["provider_unavailable"],
    });
  });
});
