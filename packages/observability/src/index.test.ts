import { describe, expect, it } from "vitest";
import {
  JsonLogger,
  MetricsRegistry,
  NoopErrorReporter,
  currentContext,
  withContext,
} from "./index";
describe("observability", () => {
  it("propagates correlation across async work", async () => {
    await withContext({ requestId: "req-1", traceId: "trace-1" }, async () => {
      await Promise.resolve();
      expect(currentContext()).toMatchObject({ requestId: "req-1", traceId: "trace-1" });
    });
  });
  it("aggressively redacts structured logs", () => {
    const lines: string[] = [];
    const logger = new JsonLogger({ write: (line) => lines.push(line) });
    logger.log("info", "submission.accepted", {
      email: "person@example.test",
      payload: { name: "secret" },
      safe: "ok",
      note: "from 192.0.2.1",
    });
    expect(lines[0]).not.toContain("person@example.test");
    expect(lines[0]).not.toContain("secret");
    expect(lines[0]).not.toContain("192.0.2.1");
    expect(lines[0]).toContain("ok");
  });
  it("rejects sensitive metric dimensions", () => {
    const metrics = new MetricsRegistry();
    metrics.increment("quota_denies_total", { plan: "free" });
    expect(() => metrics.increment("auth_failures_total", { email: "x" })).toThrow(
      "sensitive_metric_label",
    );
    expect(metrics.toPrometheus()).toContain("quota_denies_total");
  });
  it("is explicitly no-op without a DSN", () =>
    expect(new NoopErrorReporter().available).toBe(false));
});
