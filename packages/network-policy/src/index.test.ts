import { describe, expect, it } from "vitest";
import { isPublicAddress, validateNetworkUrl } from "./index";
describe("network policy", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "169.254.169.254",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "fd00::1",
    "2001:db8::1",
  ])("rejects non-public %s", (address) => expect(isPublicAddress(address)).toBe(false));
  it("validates every DNS answer", async () =>
    await expect(
      validateNetworkUrl("https://example.com", async () => ["93.184.216.34", "127.0.0.1"]),
    ).rejects.toThrow("unsafe_address"));
  it.each(["http://user:pass@example.com", "http://example.com:22", "file:///tmp/a"])(
    "rejects unsafe URL %s",
    async (url) =>
      await expect(validateNetworkUrl(url, async () => ["93.184.216.34"])).rejects.toThrow(),
  );
});
