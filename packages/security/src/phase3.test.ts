import { describe, expect, it } from "vitest";
import {
  envelopeDecrypt,
  envelopeEncrypt,
  LocalKeyProvider,
  MemoryScopedTokenRepository,
  redactMetadata,
  ScopedTokenService,
} from "./index";
describe("Phase 3 security", () => {
  it("encrypts with authenticated purpose-bound envelopes", async () => {
    const provider = new LocalKeyProvider("local-test-key-material", "test");
    const encrypted = await envelopeEncrypt("secret", provider, "integration");
    expect(encrypted.ciphertext).not.toContain("secret");
    await expect(envelopeDecrypt(encrypted, provider, "wrong")).rejects.toThrow();
    expect(await envelopeDecrypt(encrypted, provider, "integration")).toBe("secret");
  });
  it("redacts sensitive nested metadata", () =>
    expect(redactMetadata({ nested: { authorization: "Bearer x", safe: "ok" } })).toEqual({
      nested: { authorization: "[REDACTED]", safe: "ok" },
    }));
  it("issues one-time scoped tokens with expiry, revocation, exact grants and rate limits", async () => {
    const service = new ScopedTokenService(
      new MemoryScopedTokenRepository("test"),
      "test-token-hash-secret",
    );
    const now = new Date("2026-01-01T00:00:00Z");
    const issued = await service.issue(
      {
        workspaceId: "w1",
        formIds: ["f1"],
        scopes: ["forms:read"],
        expiresAt: new Date(now.getTime() + 60_000),
        rateLimitPerMinute: 1,
      },
      now,
    );
    expect("tokenHash" in issued.record).toBe(false);
    await expect(
      service.authorize(issued.token, { workspaceId: "w2", scope: "forms:read" }, now),
    ).rejects.toThrow("forbidden");
    await expect(
      service.authorize(
        issued.token,
        { workspaceId: "w1", formId: "f2", scope: "forms:read" },
        now,
      ),
    ).rejects.toThrow("forbidden");
    await expect(
      service.authorize(issued.token, { workspaceId: "w1", scope: "submissions:test" }, now),
    ).rejects.toThrow("forbidden");
    expect(
      (
        await service.authorize(
          issued.token,
          { workspaceId: "w1", formId: "f1", scope: "forms:read" },
          now,
        )
      ).id,
    ).toBe(issued.record.id);
    await expect(
      service.authorize(issued.token, { workspaceId: "w1", scope: "forms:read" }, now),
    ).rejects.toThrow("rate_limited");
    await service.revoke(issued.record.id, "w1", new Date(now.getTime() + 1));
    await expect(
      service.authorize(
        issued.token,
        { workspaceId: "w1", scope: "forms:read" },
        new Date(now.getTime() + 2),
      ),
    ).rejects.toThrow("unauthorized");
  });
  it("forbids local providers in production", () => {
    expect(() => new LocalKeyProvider("local-test-key-material", "production")).toThrow();
    expect(() => new MemoryScopedTokenRepository("production")).toThrow();
  });
});
