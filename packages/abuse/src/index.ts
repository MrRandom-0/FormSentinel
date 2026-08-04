export type RestrictionScope = "ingest" | "delivery" | "dashboard_mutation" | "api" | "billing";
export type AbuseStatus = "open" | "restricted" | "appealed" | "reinstated" | "closed";
export interface AbuseEvent {
  readonly id: string;
  readonly caseId: string;
  readonly type: string;
  readonly actorType: "signal" | "admin" | "customer";
  readonly reason: string;
  readonly ticket: string | null;
  readonly at: string;
  readonly metadata: Readonly<Record<string, unknown>>;
}
export interface AbuseCase {
  readonly id: string;
  readonly workspaceId: string;
  readonly status: AbuseStatus;
  readonly reasonCode: string;
  readonly reviewDueAt: string;
  readonly events: readonly AbuseEvent[];
}
export interface Restriction {
  readonly id: string;
  readonly caseId: string;
  readonly workspaceId: string;
  readonly scopes: readonly RestrictionScope[];
  readonly customerMessage: string;
  readonly startsAt: string;
  readonly expiresAt: string;
  readonly liftedAt: string | null;
}
export class AbuseService {
  private readonly cases = new Map<string, AbuseCase>();
  private readonly restrictions: Restriction[] = [];
  constructor(environment: "development" | "test" | "production" = "development") {
    if (environment === "production")
      throw new Error("Memory abuse repository is disabled in production.");
  }
  openSignal(
    input: { workspaceId: string; reasonCode: string; summary: string },
    now = new Date(),
  ) {
    const id = crypto.randomUUID();
    const item: AbuseCase = {
      id,
      workspaceId: input.workspaceId,
      status: "open",
      reasonCode: input.reasonCode,
      reviewDueAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      events: [this.event(id, "signal.recorded", "signal", input.summary, null, now)],
    };
    this.cases.set(id, item);
    return item;
  }
  restrict(
    caseId: string,
    input: {
      adminId: string;
      reason: string;
      ticket: string;
      scopes: readonly RestrictionScope[];
      expiresAt: Date;
      customerMessage: string;
    },
    now = new Date(),
  ) {
    const item = this.required(caseId);
    if (input.expiresAt <= now) throw new Error("restriction_must_be_temporary");
    if (!input.ticket || !input.reason) throw new Error("human_review_required");
    const restriction: Restriction = {
      id: crypto.randomUUID(),
      caseId,
      workspaceId: item.workspaceId,
      scopes: [...new Set(input.scopes)],
      customerMessage: input.customerMessage,
      startsAt: now.toISOString(),
      expiresAt: input.expiresAt.toISOString(),
      liftedAt: null,
    };
    this.restrictions.push(restriction);
    this.transition(
      item,
      "restricted",
      this.event(caseId, "restriction.applied", "admin", input.reason, input.ticket, now),
    );
    return restriction;
  }
  appeal(caseId: string, statement: string, now = new Date()) {
    const item = this.required(caseId);
    if (item.status !== "restricted") throw new Error("appeal_invalid_state");
    this.transition(
      item,
      "appealed",
      this.event(caseId, "appeal.submitted", "customer", statement, null, now),
    );
    return this.required(caseId);
  }
  decideAppeal(
    caseId: string,
    input: { adminId: string; decision: "uphold" | "reinstate"; reason: string; ticket: string },
    now = new Date(),
  ) {
    const item = this.required(caseId);
    if (item.status !== "appealed") throw new Error("decision_invalid_state");
    if (input.decision === "reinstate")
      for (let index = 0; index < this.restrictions.length; index++) {
        const restriction = this.restrictions[index]!;
        if (restriction.caseId === caseId && !restriction.liftedAt)
          this.restrictions[index] = { ...restriction, liftedAt: now.toISOString() };
      }
    this.transition(
      item,
      input.decision === "reinstate" ? "reinstated" : "restricted",
      this.event(caseId, `appeal.${input.decision}`, "admin", input.reason, input.ticket, now),
    );
    return this.required(caseId);
  }
  check(workspaceId: string, scope: RestrictionScope, now = new Date()) {
    const restriction = this.restrictions.find(
      (item) =>
        item.workspaceId === workspaceId &&
        item.scopes.includes(scope) &&
        !item.liftedAt &&
        item.startsAt <= now.toISOString() &&
        item.expiresAt > now.toISOString(),
    );
    return restriction
      ? { allowed: false as const, reason: "workspace_restricted" as const, restriction }
      : { allowed: true as const };
  }
  private required(id: string) {
    const item = this.cases.get(id);
    if (!item) throw new Error("case_not_found");
    return item;
  }
  private transition(item: AbuseCase, status: AbuseStatus, event: AbuseEvent) {
    this.cases.set(item.id, { ...item, status, events: [...item.events, event] });
  }
  private event(
    caseId: string,
    type: string,
    actorType: AbuseEvent["actorType"],
    reason: string,
    ticket: string | null,
    at: Date,
  ): AbuseEvent {
    return {
      id: crypto.randomUUID(),
      caseId,
      type,
      actorType,
      reason,
      ticket,
      at: at.toISOString(),
      metadata: {},
    };
  }
}
