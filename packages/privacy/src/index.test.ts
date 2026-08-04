import { describe, expect, it } from "vitest";
import { PrivacyService } from "./index";
describe("privacy lifecycle", () => {
  it("honors legal holds and never claims unavailable deletion", async () => {
    const service = new PrivacyService(undefined, undefined, "test");
    const request = service.request("w", "deletion");
    service.verify(request.id, "verified", new Date("2026-01-01"));
    service.placeLegalHold("w");
    expect(await service.process(request.id, new Date("2026-01-09"))).toMatchObject({
      status: "blocked_legal_hold",
    });
    service.releaseLegalHold("w");
    const result = await service.process(request.id, new Date("2026-01-09"));
    expect(result.status).toBe("partial");
    expect(result.evidence).toContain("object:adapter_unavailable");
    expect(result.evidence).toContain("provider:adapter_unavailable");
  });
  it("refuses production without deletion adapters", () =>
    expect(() => new PrivacyService(undefined, undefined, "production")).toThrow("unavailable"));
});
