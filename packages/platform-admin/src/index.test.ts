import { describe, expect, it } from "vitest";
import { PlatformAdminService, platformAdminCookie, rejectTenantCredentialForAdmin } from "./index";
describe("platform admin isolation", () => {
  it("uses a separate cookie and rejects tenant/service credentials", () => {
    expect(platformAdminCookie.name).not.toBe("formsentinel_session");
    expect(() =>
      rejectTenantCredentialForAdmin(new Headers({ authorization: "Bearer service" })),
    ).toThrow("forbidden");
  });
  it("requires MFA, reason, ticket, and optional dual approval", () => {
    const service = new PlatformAdminService("test", true);
    const identity = { adminId: "a1", role: "security" as const, mfa: true, idpSessionId: "idp" };
    expect(() =>
      service.record(identity, {
        action: "tenant:restrict",
        reason: "review",
        ticket: "SEC-1",
        correlationId: "r1",
      }),
    ).toThrow("dual_approval");
    expect(
      service.record(identity, {
        action: "tenant:restrict",
        reason: "review",
        ticket: "SEC-1",
        correlationId: "r1",
        secondApproverId: "a2",
      }),
    ).toMatchObject({ adminId: "a1", ticket: "SEC-1" });
  });
});
