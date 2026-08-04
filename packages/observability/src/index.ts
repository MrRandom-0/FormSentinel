import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
export interface ObservabilityContext {
  readonly requestId: string;
  readonly traceId: string;
  readonly workspaceId?: string;
  readonly jobId?: string;
}
const storage = new AsyncLocalStorage<ObservabilityContext>();
export const currentContext = () => storage.getStore();
export const withContext = <T>(context: Partial<ObservabilityContext>, operation: () => T): T =>
  storage.run(
    {
      requestId: context.requestId ?? randomUUID(),
      traceId: context.traceId ?? randomUUID(),
      ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
      ...(context.jobId ? { jobId: context.jobId } : {}),
    },
    operation,
  );
const sensitive = /(authorization|cookie|token|secret|password|email|payload|body|ip|address)/i;
export function redact(value: unknown, key = ""): unknown {
  if (sensitive.test(key)) return "[REDACTED]";
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([child, item]) => [
        child,
        redact(item, child),
      ]),
    );
  if (
    typeof value === "string" &&
    (/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value) ||
      /\b(?:\d{1,3}\.){3}\d{1,3}\b/.test(value))
  )
    return "[REDACTED]";
  return value;
}
export interface LogSink {
  write(line: string): void;
}
export class JsonLogger {
  constructor(
    private readonly sink: LogSink = { write: (line) => process.stdout.write(`${line}\n`) },
  ) {}
  log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
    const context = currentContext();
    this.sink.write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        event,
        ...context,
        fields: redact(fields),
      }),
    );
  }
}
interface Metric {
  name: string;
  labels: Readonly<Record<string, string>>;
  value: number;
}
const allowedMetrics = new Set([
  "http_requests_total",
  "http_request_duration_ms",
  "http_errors_total",
  "quota_denies_total",
  "auth_failures_total",
  "queue_lag_ms",
  "queue_retries_total",
  "dead_letters_total",
  "stripe_lag_seconds",
  "stripe_failures_total",
  "delivery_failures_total",
  "storage_failures_total",
  "scanner_failures_total",
  "privacy_request_age_seconds",
  "abuse_review_age_seconds",
  "suspicious_admin_actions_total",
]);
export class MetricsRegistry {
  private readonly values = new Map<string, Metric>();
  increment(name: string, labels: Readonly<Record<string, string>> = {}, amount = 1) {
    this.observe(name, amount, labels);
  }
  observe(name: string, value: number, labels: Readonly<Record<string, string>> = {}) {
    if (!allowedMetrics.has(name)) throw new Error("metric_not_allowlisted");
    if (Object.keys(labels).some((key) => sensitive.test(key)))
      throw new Error("sensitive_metric_label");
    const normalized = Object.fromEntries(
      Object.entries(labels).sort(([a], [b]) => a.localeCompare(b)),
    );
    const key = `${name}:${JSON.stringify(normalized)}`;
    const prior = this.values.get(key);
    this.values.set(key, { name, labels: normalized, value: (prior?.value ?? 0) + value });
  }
  snapshot(): readonly Metric[] {
    return [...this.values.values()];
  }
  toPrometheus() {
    return this.snapshot()
      .map(
        (metric) =>
          `${metric.name}${
            Object.keys(metric.labels).length
              ? `{${Object.entries(metric.labels)
                  .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
                  .join(",")}}`
              : ""
          } ${metric.value}`,
      )
      .join("\n");
  }
}
export interface ErrorReporter {
  readonly available: boolean;
  capture(error: unknown, context?: Record<string, unknown>): void;
}
export class NoopErrorReporter implements ErrorReporter {
  readonly available = false;
  capture() {}
}
export class HttpSentryReporter implements ErrorReporter {
  readonly available = true;
  constructor(
    private readonly dsn: string,
    private readonly request: typeof fetch = fetch,
  ) {
    if (!dsn.startsWith("https://")) throw new Error("invalid_sentry_dsn");
  }
  capture(error: unknown, context: Record<string, unknown> = {}) {
    const message = error instanceof Error ? error.message : "unknown_error";
    void this.request(this.dsn, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(redact({ message, context, current: currentContext() })),
    }).catch(() => undefined);
  }
}
export const errorReporterFromEnvironment = (
  source: NodeJS.ProcessEnv = process.env,
): ErrorReporter =>
  source.SENTRY_DSN ? new HttpSentryReporter(source.SENTRY_DSN) : new NoopErrorReporter();
