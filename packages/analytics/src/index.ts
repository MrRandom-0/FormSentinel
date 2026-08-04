import { isIP } from "node:net";

export type UsageMetric = "submission_received" | "form_created" | "member_added";
export interface UsageEvent {
  workspaceId: string;
  metric: UsageMetric;
  quantity: number;
  occurredAt: string;
  metadata?: Readonly<Record<string, unknown>>;
}
export interface AnalyticsSink {
  record(event: UsageEvent): Promise<void>;
}

export const analyticsEventNames = [
  "submission_received",
  "submission_spam",
  "delivery_completed",
  "delivery_error",
  "health_changed",
  "drift_detected",
  "conversion_viewed",
  "conversion_started",
  "conversion_validation",
  "conversion_attempted",
  "conversion_succeeded",
] as const;
export type AnalyticsEventName = (typeof analyticsEventNames)[number];
export type ConsentMode = "none" | "essential" | "analytics";
export interface PrivacySafeAnalyticsEvent {
  id: string;
  workspaceId: string;
  formId: string;
  name: AnalyticsEventName;
  occurredAt: string;
  dimensions: Readonly<
    Partial<
      Record<
        | "source"
        | "referrerHost"
        | "utmSource"
        | "utmMedium"
        | "utmCampaign"
        | "country"
        | "device"
        | "delivery"
        | "errorCode"
        | "health"
        | "drift",
        string
      >
    >
  >;
  metrics: Readonly<Partial<Record<"count" | "latencyMs" | "spamScore", number>>>;
}
const conversions = new Set<AnalyticsEventName>([
  "conversion_viewed",
  "conversion_started",
  "conversion_validation",
  "conversion_attempted",
  "conversion_succeeded",
]);
const dimensionKeys = new Set([
  "source",
  "referrerHost",
  "utmSource",
  "utmMedium",
  "utmCampaign",
  "country",
  "device",
  "delivery",
  "errorCode",
  "health",
  "drift",
]);
const metricKeys = new Set(["count", "latencyMs", "spamScore"]);
const forbiddenAnalyticsKey =
  /payload|email|name|phone|address|ip|token|secret|authorization|cookie|metadata/i;
const emailPattern = /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/;
function decodedAnalyticsValues(value: string): string[] {
  const values = new Set([value.trim()]);
  let decoded = value;
  for (let attempt = 0; attempt < 2; attempt += 1)
    try {
      decoded = decodeURIComponent(decoded.replaceAll("+", " "));
      values.add(decoded.trim());
    } catch {
      break;
    }
  if (/^[A-Za-z0-9+/_-]{8,}={0,2}$/.test(value))
    try {
      const base64 = Buffer.from(
        value.replaceAll("-", "+").replaceAll("_", "/"),
        "base64",
      ).toString("utf8");
      if (!base64.includes("�")) values.add(base64.trim());
    } catch {
      // Invalid encodings are handled as ordinary dimensions.
    }
  return [...values];
}
function containsAddressOrPii(value: string): boolean {
  return decodedAnalyticsValues(value).some((candidate) => {
    if (emailPattern.test(candidate) || /Bearer\s/i.test(candidate)) return true;
    const unwrapped = candidate.replace(/^\[|\](?::\d+)?$/g, "");
    if (isIP(unwrapped)) return true;
    const hostPort = /^([^:]+):(\d+)$/.exec(candidate);
    if (hostPort && isIP(hostPort[1]!)) return true;
    try {
      const hostname = new URL(candidate.includes("://") ? candidate : `http://${candidate}`)
        .hostname;
      if (isIP(hostname.replace(/^\[|\]$/g, ""))) return true;
    } catch {
      // Not a host-like value.
    }
    return /\b\d{1,3}(?:\.\d{1,3}){3}\b/.test(candidate);
  });
}
export function validateAnalyticsEvent(
  input: Omit<PrivacySafeAnalyticsEvent, "id" | "occurredAt"> & { occurredAt?: string },
  consent: ConsentMode,
): Omit<PrivacySafeAnalyticsEvent, "id"> {
  if (!analyticsEventNames.includes(input.name)) throw new Error("analytics_event_not_allowed");
  if (conversions.has(input.name) && consent !== "analytics")
    throw new Error("analytics_consent_required");
  for (const [key, value] of Object.entries(input.dimensions)) {
    if (
      !dimensionKeys.has(key) ||
      forbiddenAnalyticsKey.test(key) ||
      typeof value !== "string" ||
      value.length > 200 ||
      containsAddressOrPii(value)
    )
      throw new Error("analytics_dimension_rejected");
  }
  for (const [key, value] of Object.entries(input.metrics))
    if (!metricKeys.has(key) || typeof value !== "number" || !Number.isFinite(value) || value < 0)
      throw new Error("analytics_metric_rejected");
  return {
    workspaceId: input.workspaceId,
    formId: input.formId,
    name: input.name,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    dimensions: { ...input.dimensions },
    metrics: { ...input.metrics },
  };
}
export class LocalAnalyticsStore {
  private readonly events: PrivacySafeAnalyticsEvent[] = [];
  constructor(
    environment: "development" | "test" | "production" = "development",
    private readonly retentionDays = 30,
  ) {
    if (environment === "production")
      throw new Error("Local analytics adapter is disabled in production.");
  }
  record(
    input: Omit<PrivacySafeAnalyticsEvent, "id" | "occurredAt"> & { occurredAt?: string },
    consent: ConsentMode,
  ): PrivacySafeAnalyticsEvent {
    const event = { ...validateAnalyticsEvent(input, consent), id: crypto.randomUUID() };
    this.events.push(event);
    return structuredClone(event);
  }
  aggregate(
    workspaceId: string,
    formId: string,
  ): readonly { name: AnalyticsEventName; count: number; averageLatencyMs: number | null }[] {
    const groups = new Map<AnalyticsEventName, PrivacySafeAnalyticsEvent[]>();
    for (const event of this.events.filter(
      (item) => item.workspaceId === workspaceId && item.formId === formId,
    ))
      groups.set(event.name, [...(groups.get(event.name) ?? []), event]);
    return [...groups]
      .map(([name, events]) => {
        const latencies = events
          .map((event) => event.metrics.latencyMs)
          .filter((value): value is number => value !== undefined);
        return {
          name,
          count: events.length,
          averageLatencyMs: latencies.length
            ? Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length)
            : null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }
  purge(now = new Date()): number {
    const cutoff = now.getTime() - this.retentionDays * 86_400_000;
    const retained = this.events.filter((item) => Date.parse(item.occurredAt) >= cutoff);
    const removed = this.events.length - retained.length;
    this.events.splice(0, this.events.length, ...retained);
    return removed;
  }
  deleteForm(workspaceId: string, formId: string): number {
    const retained = this.events.filter(
      (item) => item.workspaceId !== workspaceId || item.formId !== formId,
    );
    const removed = this.events.length - retained.length;
    this.events.splice(0, this.events.length, ...retained);
    return removed;
  }
}
const encode = (value: Uint8Array) =>
  btoa(String.fromCharCode(...value))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const decode = (value: string) =>
  Uint8Array.from(
    atob(value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4)),
    (character) => character.charCodeAt(0),
  );
export class AttributionTokens {
  private readonly used = new Set<string>();
  constructor(
    private readonly secret: string,
    private readonly ttlMs = 30 * 60_000,
  ) {
    if (secret.length < 16) throw new Error("Attribution secret is too short.");
  }
  private async signature(body: string): Promise<string> {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(this.secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    return encode(
      new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))),
    );
  }
  async issue(input: { formId: string; source?: string }, now = new Date()): Promise<string> {
    const body = encode(
      new TextEncoder().encode(
        JSON.stringify({
          id: crypto.randomUUID(),
          formId: input.formId,
          source: input.source?.slice(0, 100),
          exp: now.getTime() + this.ttlMs,
        }),
      ),
    );
    return `${body}.${await this.signature(body)}`;
  }
  async consume(token: string, formId: string, now = new Date()): Promise<{ source?: string }> {
    const [body, signature] = token.split(".");
    if (!body || !signature || signature !== (await this.signature(body)))
      throw new Error("invalid_attribution_token");
    const value = JSON.parse(new TextDecoder().decode(decode(body))) as {
      id: string;
      formId: string;
      source?: string;
      exp: number;
    };
    if (value.formId !== formId || value.exp <= now.getTime())
      throw new Error("invalid_attribution_token");
    if (this.used.has(value.id)) throw new Error("attribution_replay");
    this.used.add(value.id);
    return value.source === undefined ? {} : { source: value.source };
  }
}
