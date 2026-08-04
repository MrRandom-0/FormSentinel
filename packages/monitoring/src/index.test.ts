import { describe, expect, it } from "vitest";
import {
  CapturedLocalAlertAdapter,
  MonitorIncidentTracker,
  runMonitor,
  scheduleNext,
  type MonitorRun,
} from "./index";
const run = (id: string, status: MonitorRun["status"]): MonitorRun => ({
  id,
  scheduleId: "m1",
  synthetic: true,
  status,
  steps: [],
  startedAt: `2026-01-01T00:00:0${id}Z`,
  finishedAt: `2026-01-01T00:00:0${id}Z`,
});
describe("monitoring", () => {
  it("opens and resolves only at consecutive thresholds", () => {
    const tracker = new MonitorIncidentTracker(2, 2);
    expect(tracker.apply(run("1", "failed"))).toBeNull();
    expect(tracker.apply(run("2", "failed"))?.status).toBe("open");
    expect(tracker.apply(run("3", "passed"))?.status).toBe("open");
    expect(tracker.apply(run("4", "passed"))?.status).toBe("resolved");
  });
  it("runs synthetic checks and tells the truth about browser coverage", async () => {
    const checks = {
      pageReachability: async () => ({}),
      staticFormDiscovery: async () => ({}),
      endpoint: async () => ({}),
      fields: async () => ({}),
      submitSynthetic: async () => ({ test: true }),
      processing: async () => ({}),
      delivery: async () => ({ suppressed: true }),
    };
    const result = await runMonitor(
      {
        id: "m1",
        workspaceId: "w1",
        formId: "f1",
        frequency: "manual",
        active: true,
        nextRunAt: null,
      },
      checks,
    );
    expect(result.synthetic).toBe(true);
    expect(result.steps.at(-1)?.status).toBe("unavailable");
    expect(result.status).toBe("partial");
  });
  it("supports intervals and local alert capture", async () => {
    expect(scheduleNext("6h", new Date(0))).toBe(new Date(21_600_000).toISOString());
    expect(
      (
        await new CapturedLocalAlertAdapter("test").send({
          incidentId: "i",
          destination: "email",
          message: "down",
        })
      ).state,
    ).toBe("captured_local");
    expect(() => new CapturedLocalAlertAdapter("production")).toThrow();
  });
});
