export type PrivacyKind = "export" | "deletion";
export interface DeletionAdapter {
  readonly capability: string;
  deleteWorkspace(workspaceId: string): Promise<{ deleted: boolean; evidence?: string }>;
}
export interface PrivacyRequest {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: PrivacyKind;
  readonly status:
    | "pending_verification"
    | "grace"
    | "processing"
    | "completed"
    | "blocked_legal_hold"
    | "canceled"
    | "partial";
  readonly graceEndsAt: string | null;
  readonly evidence: readonly string[];
}
export class PrivacyService {
  private readonly requests = new Map<string, PrivacyRequest>();
  private readonly holds = new Set<string>();
  private readonly completedSteps = new Set<string>();
  constructor(
    private readonly objectStorage?: DeletionAdapter,
    private readonly provider?: DeletionAdapter,
    environment: "development" | "test" | "production" = "development",
  ) {
    if (environment === "production" && (!objectStorage || !provider))
      throw new Error("Production privacy deletion adapters are unavailable.");
  }
  placeLegalHold(workspaceId: string) {
    this.holds.add(workspaceId);
  }
  releaseLegalHold(workspaceId: string) {
    this.holds.delete(workspaceId);
  }
  request(workspaceId: string, kind: PrivacyKind) {
    const item: PrivacyRequest = {
      id: crypto.randomUUID(),
      workspaceId,
      kind,
      status: "pending_verification",
      graceEndsAt: null,
      evidence: [],
    };
    this.requests.set(item.id, item);
    return item;
  }
  verify(id: string, verificationRef: string, now = new Date()) {
    if (!verificationRef) throw new Error("identity_reverification_required");
    const item = this.required(id);
    const next = {
      ...item,
      status: "grace" as const,
      graceEndsAt: new Date(now.getTime() + 7 * 86400000).toISOString(),
    };
    this.requests.set(id, next);
    return next;
  }
  cancel(id: string) {
    const item = this.required(id);
    if (item.status !== "grace") throw new Error("privacy_cancel_invalid_state");
    const next = { ...item, status: "canceled" as const };
    this.requests.set(id, next);
    return next;
  }
  async process(id: string, now = new Date()) {
    let item = this.required(id);
    if (item.kind === "deletion" && this.holds.has(item.workspaceId)) {
      item = { ...item, status: "blocked_legal_hold" };
      this.requests.set(id, item);
      return item;
    }
    if (
      (item.status !== "grace" && item.status !== "blocked_legal_hold") ||
      !item.graceEndsAt ||
      item.graceEndsAt > now.toISOString()
    )
      throw new Error("privacy_grace_active");
    const evidence = [...item.evidence];
    for (const [step, adapter] of [
      ["object", this.objectStorage],
      ["provider", this.provider],
    ] as const) {
      const key = `${id}:${step}`;
      if (this.completedSteps.has(key)) continue;
      if (!adapter) {
        evidence.push(`${step}:adapter_unavailable`);
        continue;
      }
      const result = await adapter.deleteWorkspace(item.workspaceId);
      if (!result.deleted) {
        evidence.push(`${step}:not_confirmed`);
        continue;
      }
      this.completedSteps.add(key);
      evidence.push(`${step}:${result.evidence ?? "confirmed"}`);
    }
    const partial = evidence.some(
      (value) => value.includes("unavailable") || value.includes("not_confirmed"),
    );
    item = { ...item, status: partial ? "partial" : "completed", evidence };
    this.requests.set(id, item);
    return item;
  }
  private required(id: string) {
    const item = this.requests.get(id);
    if (!item) throw new Error("privacy_request_not_found");
    return item;
  }
}
export const retentionClasses = {
  submission: 365,
  audit: 2555,
  billing: 2555,
  security: 730,
  artifact: 7,
} as const;
export const backupDeletionWindowDays = 35;
