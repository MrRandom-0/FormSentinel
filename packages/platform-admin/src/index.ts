export const platformAdminCookie = {
  name: "formsentinel_operator_session",
  options: { httpOnly: true, secure: true, sameSite: "strict" as const, path: "/operator" },
};
export type PlatformRole = "reviewer" | "operator" | "security";
export interface PlatformIdentity {
  readonly adminId: string;
  readonly role: PlatformRole;
  readonly mfa: boolean;
  readonly idpSessionId: string;
}
export interface PlatformAudit {
  readonly id: string;
  readonly adminId: string;
  readonly action: string;
  readonly targetId: string | null;
  readonly reason: string;
  readonly ticket: string;
  readonly correlationId: string;
  readonly at: string;
}
export function platformAdminCapability(source: NodeJS.ProcessEnv = process.env) {
  return source.OPERATOR_IDP_ISSUER &&
    source.OPERATOR_IDP_CLIENT_ID &&
    source.OPERATOR_MFA_REQUIRED === "true"
    ? { available: true as const }
    : { available: false as const, reason: "operator_idp_mfa_not_configured" };
}
export class PlatformAdminService {
  readonly audit: PlatformAudit[] = [];
  constructor(
    private readonly environment: "development" | "test" | "production",
    private readonly dualApproval = false,
  ) {
    if (environment === "production" && !platformAdminCapability().available)
      throw new Error("Platform admin unavailable without operator IdP and mandatory MFA.");
  }
  authorize(identity: PlatformIdentity, action: string) {
    if (!identity.mfa) throw new Error("operator_mfa_required");
    if (action.startsWith("tenant:") && identity.role === "reviewer")
      throw new Error("operator_permission_denied");
  }
  record(
    identity: PlatformIdentity,
    input: {
      action: string;
      targetId?: string;
      reason: string;
      ticket: string;
      correlationId: string;
      secondApproverId?: string;
    },
    now = new Date(),
  ) {
    this.authorize(identity, input.action);
    if (!input.reason.trim() || !input.ticket.trim())
      throw new Error("operator_reason_ticket_required");
    if (
      this.dualApproval &&
      input.action.startsWith("tenant:restrict") &&
      (!input.secondApproverId || input.secondApproverId === identity.adminId)
    )
      throw new Error("operator_dual_approval_required");
    const event: PlatformAudit = {
      id: crypto.randomUUID(),
      adminId: identity.adminId,
      action: input.action,
      targetId: input.targetId ?? null,
      reason: input.reason,
      ticket: input.ticket,
      correlationId: input.correlationId,
      at: now.toISOString(),
    };
    this.audit.push(event);
    return event;
  }
}
export function rejectTenantCredentialForAdmin(headers: Headers) {
  if (headers.has("authorization") || headers.get("cookie")?.includes("formsentinel_session"))
    throw new Error("tenant_or_service_credential_forbidden");
}
