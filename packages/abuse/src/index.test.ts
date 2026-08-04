import { describe, expect, it } from "vitest";
import { AbuseService } from "./index";
describe("abuse lifecycle", () => {
  it("requires human review, temporary restrictions, appeals, and reinstatement", () => {
    const service = new AbuseService("test");
    const item = service.openSignal(
      { workspaceId: "w", reasonCode: "volume", summary: "bounded signal" },
      new Date("2026-01-01"),
    );
    expect(() =>
      service.restrict(item.id, {
        adminId: "a",
        reason: "reviewed",
        ticket: "T-1",
        scopes: ["ingest"],
        expiresAt: new Date("2025-01-01"),
        customerMessage: "Review in progress",
      }),
    ).toThrow("temporary");
    service.restrict(
      item.id,
      {
        adminId: "a",
        reason: "reviewed",
        ticket: "T-1",
        scopes: ["ingest"],
        expiresAt: new Date("2027-01-01"),
        customerMessage: "Review in progress",
      },
      new Date("2026-01-01"),
    );
    expect(service.check("w", "ingest", new Date("2026-01-02"))).toMatchObject({ allowed: false });
    service.appeal(item.id, "Please review", new Date("2026-01-02"));
    service.decideAppeal(
      item.id,
      { adminId: "b", decision: "reinstate", reason: "evidence reviewed", ticket: "T-2" },
      new Date("2026-01-03"),
    );
    expect(service.check("w", "ingest", new Date("2026-01-03"))).toEqual({ allowed: true });
  });
});
