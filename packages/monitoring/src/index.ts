export type MonitorFrequency = "hourly" | "6h" | "daily" | "weekly" | "manual" | "deployment";
export type MonitorStepName =
  | "page_reachability"
  | "static_form_discovery"
  | "endpoint"
  | "fields"
  | "submission_accepted"
  | "processing"
  | "delivery"
  | "latency"
  | "browser";
export interface MonitorSchedule {
  id: string;
  workspaceId: string;
  formId: string;
  frequency: MonitorFrequency;
  active: boolean;
  nextRunAt: string | null;
}
export interface MonitorStepEvidence {
  step: MonitorStepName;
  status: "passed" | "failed" | "unavailable";
  evidence: Readonly<Record<string, string | number | boolean | null>>;
  at: string;
}
export interface MonitorRun {
  id: string;
  scheduleId: string;
  synthetic: true;
  status: "passed" | "failed" | "partial";
  steps: readonly MonitorStepEvidence[];
  startedAt: string;
  finishedAt: string;
}
export interface MonitorIncident {
  id: string;
  scheduleId: string;
  status: "open" | "resolved";
  openedAt: string;
  resolvedAt: string | null;
  events: readonly {
    type: "opened" | "failure" | "recovery" | "resolved";
    runId: string;
    at: string;
  }[];
}
const interval = (frequency: MonitorFrequency): number | null =>
  ({
    hourly: 3_600_000,
    "6h": 21_600_000,
    daily: 86_400_000,
    weekly: 604_800_000,
    manual: null,
    deployment: null,
  })[frequency];
export function scheduleNext(frequency: MonitorFrequency, from = new Date()): string | null {
  const milliseconds = interval(frequency);
  return milliseconds ? new Date(from.getTime() + milliseconds).toISOString() : null;
}
export function dueSchedules(
  schedules: readonly MonitorSchedule[],
  now = new Date(),
): readonly MonitorSchedule[] {
  return schedules.filter(
    (item) => item.active && item.nextRunAt && Date.parse(item.nextRunAt) <= now.getTime(),
  );
}
export class MonitorIncidentTracker {
  private failures = 0;
  private successes = 0;
  private incident: MonitorIncident | null = null;
  constructor(
    private readonly failureThreshold = 2,
    private readonly recoveryThreshold = 2,
  ) {}
  apply(run: MonitorRun): MonitorIncident | null {
    const failed = run.status === "failed";
    this.failures = failed ? this.failures + 1 : 0;
    this.successes = failed ? 0 : this.successes + 1;
    if (failed && !this.incident && this.failures >= this.failureThreshold)
      this.incident = {
        id: crypto.randomUUID(),
        scheduleId: run.scheduleId,
        status: "open",
        openedAt: run.finishedAt,
        resolvedAt: null,
        events: [{ type: "opened", runId: run.id, at: run.finishedAt }],
      };
    else if (failed && this.incident?.status === "open")
      this.incident = {
        ...this.incident,
        events: [...this.incident.events, { type: "failure", runId: run.id, at: run.finishedAt }],
      };
    else if (!failed && this.incident?.status === "open" && this.successes < this.recoveryThreshold)
      this.incident = {
        ...this.incident,
        events: [...this.incident.events, { type: "recovery", runId: run.id, at: run.finishedAt }],
      };
    else if (
      !failed &&
      this.incident?.status === "open" &&
      this.successes >= this.recoveryThreshold
    )
      this.incident = {
        ...this.incident,
        status: "resolved",
        resolvedAt: run.finishedAt,
        events: [...this.incident.events, { type: "resolved", runId: run.id, at: run.finishedAt }],
      };
    return this.incident ? structuredClone(this.incident) : null;
  }
}
export interface MonitorChecks {
  pageReachability(): Promise<Readonly<Record<string, string | number | boolean | null>>>;
  staticFormDiscovery(): Promise<Readonly<Record<string, string | number | boolean | null>>>;
  endpoint(): Promise<Readonly<Record<string, string | number | boolean | null>>>;
  fields(): Promise<Readonly<Record<string, string | number | boolean | null>>>;
  submitSynthetic(): Promise<Readonly<Record<string, string | number | boolean | null>>>;
  processing(): Promise<Readonly<Record<string, string | number | boolean | null>>>;
  delivery(): Promise<Readonly<Record<string, string | number | boolean | null>>>;
}
export async function runMonitor(
  schedule: MonitorSchedule,
  checks: MonitorChecks,
  options: { browserConfigured?: boolean; now?: () => Date } = {},
): Promise<MonitorRun> {
  const started = options.now?.() ?? new Date();
  const steps: MonitorStepEvidence[] = [];
  const execute = async (
    step: MonitorStepName,
    action: () => Promise<Readonly<Record<string, string | number | boolean | null>>>,
  ) => {
    try {
      steps.push({
        step,
        status: "passed",
        evidence: await action(),
        at: (options.now?.() ?? new Date()).toISOString(),
      });
    } catch (error) {
      steps.push({
        step,
        status: "failed",
        evidence: { error: error instanceof Error ? error.message.slice(0, 200) : "check_failed" },
        at: (options.now?.() ?? new Date()).toISOString(),
      });
    }
  };
  await execute("page_reachability", () => checks.pageReachability());
  await execute("static_form_discovery", () => checks.staticFormDiscovery());
  await execute("endpoint", () => checks.endpoint());
  await execute("fields", () => checks.fields());
  await execute("submission_accepted", () => checks.submitSynthetic());
  await execute("processing", () => checks.processing());
  await execute("delivery", () => checks.delivery());
  if (!options.browserConfigured)
    steps.push({
      step: "browser",
      status: "unavailable",
      evidence: { reason: "browser_runtime_not_configured" },
      at: (options.now?.() ?? new Date()).toISOString(),
    });
  const finished = options.now?.() ?? new Date();
  return {
    id: crypto.randomUUID(),
    scheduleId: schedule.id,
    synthetic: true,
    status: steps.some((step) => step.status === "failed")
      ? "failed"
      : steps.some((step) => step.status === "unavailable")
        ? "partial"
        : "passed",
    steps,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
  };
}
export interface AlertAdapter {
  send(input: {
    incidentId: string;
    destination: string;
    message: string;
  }): Promise<{ state: "captured_local" | "delivered" | "unavailable" }>;
}
export class CapturedLocalAlertAdapter implements AlertAdapter {
  constructor(environment: "development" | "test" | "production" = "development") {
    if (environment === "production")
      throw new Error("Captured alert adapter is disabled in production.");
  }
  async send(_input: { incidentId: string; destination: string; message: string }) {
    return { state: "captured_local" as const };
  }
}
export class UnavailableAlertAdapter implements AlertAdapter {
  async send(_input: { incidentId: string; destination: string; message: string }) {
    return { state: "unavailable" as const };
  }
}
