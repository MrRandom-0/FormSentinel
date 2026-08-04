import { describe, expect, it } from "vitest";
import { catalog, planIds, resolveEntitlements } from "./index";

describe("versioned commercial catalog", () => {
  it("preserves established limits and defines every plan", () => {
    expect(planIds).toEqual(["free", "starter", "pro", "agency"]);
    expect(catalog.free.limits).toMatchObject({ forms: 2, members: 1, monthlySubmissions: 100 });
    expect(catalog.pro.limits).toMatchObject({
      forms: 50,
      members: 10,
      monthlySubmissions: 10_000,
    });
    expect(catalog.starter.monthlyPriceCents).toBe(1_900);
    expect(catalog.agency.monthlyPriceCents).toBe(14_900);
  });

  it("returns typed quota and restriction denials", () => {
    const free = resolveEntitlements({ plan: "free", workspaceId: "w" });
    expect(free.checkLimit("monthlySubmissions", 100)).toMatchObject({
      allowed: false,
      reason: "monthly_quota_reached",
    });
    expect(
      resolveEntitlements({ plan: "pro", workspaceId: "w", restricted: true }).checkFeature("api"),
    ).toEqual({ allowed: false, reason: "workspace_restricted" });
  });

  it("only applies current, audited, workspace-scoped overrides", () => {
    const now = new Date("2026-08-01T12:00:00Z");
    const resolved = resolveEntitlements({
      plan: "free",
      workspaceId: "w1",
      now,
      overrides: [
        {
          id: "valid",
          workspaceId: "w1",
          limit: "forms",
          value: 5,
          reason: "Incident credit",
          ticket: "SUP-1",
          actorId: "admin-1",
          startsAt: new Date("2026-08-01T00:00:00Z"),
          expiresAt: new Date("2026-08-02T00:00:00Z"),
        },
        {
          id: "other-tenant",
          workspaceId: "w2",
          limit: "forms",
          value: 100,
          reason: "test",
          ticket: "SUP-2",
          actorId: "admin-1",
          startsAt: new Date("2026-08-01T00:00:00Z"),
          expiresAt: new Date("2026-08-02T00:00:00Z"),
        },
      ],
    });
    expect(resolved.limits.forms).toBe(5);
    expect(resolved.appliedOverrideIds).toEqual(["valid"]);
  });
});
