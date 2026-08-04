import { describe, expect, it } from "vitest";
import { isUnsafeAddress, signWebhook, validateWebhookDestination, verifyWebhook } from "./index";
describe("webhook security", () => {
  it("signs and verifies exact bytes", () => {
    const signature = signWebhook('{"ok":true}', "secret", 1000);
    expect(verifyWebhook('{"ok":true}', signature, "secret", 1000)).toBe(true);
    expect(verifyWebhook('{"ok": true}', signature, "secret", 1000)).toBe(false);
  });
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "::1",
    "0:0:0:0:0:0:0:1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "224.0.0.1",
  ])("rejects unsafe address %s", (address) => expect(isUnsafeAddress(address)).toBe(true));
  it("checks every DNS answer on every attempt", async () => {
    let calls = 0;
    const resolver = async () => (++calls === 1 ? ["203.0.113.1"] : ["127.0.0.1"]);
    await expect(
      validateWebhookDestination("https://hooks.example.test/path", resolver),
    ).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it("rejects credentials and unsafe ports", async () => {
    const resolver = async () => ["8.8.8.8"];
    await expect(
      validateWebhookDestination("https://u:p@example.test", resolver),
    ).rejects.toThrow();
    await expect(validateWebhookDestination("https://example.test:22", resolver)).rejects.toThrow();
  });
});
