import { describe, expect, it } from "vitest";
import { MemorySlidingWindowRateLimiter, retryDelay, trustedSourceAddress } from "./index";
describe("queue utilities", () => {
  it("refuses process-local rate limiting in production", () => {
    expect(() => new MemorySlidingWindowRateLimiter("production")).toThrow(
      /disabled in production/,
    );
  });
  it("ignores forwarding by default and trusts only complete configured hop chains", () => {
    expect(trustedSourceAddress("10.0.0.2", "198.51.100.1, 10.0.0.1", 0)).toBe("10.0.0.2");
    expect(trustedSourceAddress("10.0.0.2", "198.51.100.1, 10.0.0.1", 2)).toBe("198.51.100.1");
    expect(trustedSourceAddress("10.0.0.2", "198.51.100.1", 2)).toBe("10.0.0.2");
    expect(trustedSourceAddress("10.0.0.2", "spoofed, 10.0.0.1", 2)).toBe("10.0.0.2");
  });
  it("limits a sliding window and supplies retry time", async () => {
    const limiter = new MemorySlidingWindowRateLimiter();
    expect((await limiter.consume("key", 1, 1000, 0)).allowed).toBe(true);
    const denied = await limiter.consume("key", 1, 1000, 1);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(1);
    expect((await limiter.consume("key", 1, 1000, 1001)).allowed).toBe(true);
  });
  it("bounds retry jitter", () => {
    expect(retryDelay(3, 1000, 10000, () => 0)).toBe(3000);
    expect(retryDelay(3, 1000, 10000, () => 1)).toBe(5000);
  });
});
