import { describe, expect, it } from "vitest";
import { catalog, resolveEntitlements } from "@formsentinel/entitlements";
import { stripeCapability } from "@formsentinel/billing";
import { platformAdminCapability } from "@formsentinel/platform-admin";
describe("Phase 4 launch status", () => {
  it("keeps hosted production unavailable without genuine dependencies", () => {
    expect(stripeCapability({ mode: "live", prices: {}, allowedReturnOrigins: [] })).toMatchObject({
      available: false,
    });
    expect(platformAdminCapability({})).toMatchObject({ available: false });
  });
  it("resolves every plan through one catalog", () => {
    for (const plan of Object.keys(catalog) as (keyof typeof catalog)[]) {
      const resolved = resolveEntitlements({ plan, workspaceId: "w" });
      expect(resolved.catalogVersion).toBeTruthy();
      expect(resolved.limits.monthlySubmissions).toBeGreaterThan(0);
    }
  });
});
