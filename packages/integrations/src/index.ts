import { signWebhook, type WebhookTransport } from "@formsentinel/webhooks";
export const integrationKeys = [
  "slack",
  "discord",
  "telegram",
  "google_sheets",
  "notion",
  "airtable",
  "zapier",
  "make",
  "generic_webhook",
  "email",
] as const;
export type IntegrationKey = (typeof integrationKeys)[number];
export type IntegrationState =
  "captured_local" | "connected" | "disconnected" | "unavailable" | "unhealthy";
export interface IntegrationDescriptor {
  key: IntegrationKey;
  name: string;
  permissions: readonly string[];
  supportsOfficialCredentials: boolean;
}
const names: Record<IntegrationKey, string> = {
  slack: "Slack",
  discord: "Discord",
  telegram: "Telegram",
  google_sheets: "Google Sheets",
  notion: "Notion",
  airtable: "Airtable",
  zapier: "Zapier",
  make: "Make",
  generic_webhook: "Generic webhook",
  email: "Email",
};
export const integrationCatalog: readonly IntegrationDescriptor[] = integrationKeys.map((key) => ({
  key,
  name: names[key],
  permissions:
    key === "generic_webhook"
      ? ["Send signed event payloads to the configured HTTPS URL."]
      : key === "email"
        ? ["Send notification email to configured recipients."]
        : [`Send FormSentinel events to ${names[key]}; read no unrelated provider data.`],
  supportsOfficialCredentials: key === "generic_webhook",
}));
export interface IntegrationConnection {
  id: string;
  workspaceId: string;
  key: IntegrationKey;
  state: IntegrationState;
  configuration: Readonly<Record<string, string>>;
  createdAt: string;
  updatedAt: string;
}
export interface IntegrationResult {
  state: "captured_local" | "delivered" | "unavailable" | "failed";
  responseCode?: number;
  error?: string;
}
export interface IntegrationAdapter {
  readonly key: IntegrationKey;
  connect(configuration: Readonly<Record<string, string>>): Promise<IntegrationState>;
  test(configuration: Readonly<Record<string, string>>): Promise<IntegrationResult>;
  disconnect(): Promise<void>;
  deliver(input: {
    deliveryId: string;
    payload: unknown;
    configuration: Readonly<Record<string, string>>;
  }): Promise<IntegrationResult>;
  health(): Promise<IntegrationState>;
  permissions(): readonly string[];
}
export interface IntegrationCapture {
  workspaceId: string;
  integrationKey: IntegrationKey;
  deliveryId: string;
  payload: unknown;
  configuration: Readonly<Record<string, string>>;
  createdAt: string;
}
export interface IntegrationCaptureRepository {
  insertIfAbsent(capture: IntegrationCapture): Promise<IntegrationCapture>;
  get(workspaceId: string, deliveryId: string): Promise<IntegrationCapture | null>;
}
const redactCapture = (value: unknown, key = ""): unknown => {
  if (/email|phone|name|address|token|secret|authorization|cookie|payload|body/i.test(key))
    return "[REDACTED]";
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactCapture(item));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 100)
        .map(([childKey, child]) => [childKey, redactCapture(child, childKey)]),
    );
  return typeof value === "string" ? value.slice(0, 500) : value;
};
export class MemoryIntegrationCaptureRepository implements IntegrationCaptureRepository {
  private readonly captures = new Map<string, IntegrationCapture>();
  constructor(environment: "development" | "test" | "production" = "development") {
    if (environment === "production")
      throw new Error("Memory integration capture repository is disabled in production.");
  }
  async insertIfAbsent(capture: IntegrationCapture): Promise<IntegrationCapture> {
    const key = `${capture.workspaceId}:${capture.deliveryId}`;
    const prior = this.captures.get(key);
    if (prior) return structuredClone(prior);
    const immutable = structuredClone(capture);
    this.captures.set(key, immutable);
    return structuredClone(immutable);
  }
  async get(workspaceId: string, deliveryId: string): Promise<IntegrationCapture | null> {
    const capture = this.captures.get(`${workspaceId}:${deliveryId}`);
    return capture ? structuredClone(capture) : null;
  }
}
export class CapturedLocalIntegrationAdapter implements IntegrationAdapter {
  readonly key: IntegrationKey;
  private state: IntegrationState = "disconnected";
  constructor(
    key: IntegrationKey,
    environment: "development" | "test" | "production" = "development",
    private readonly captures: IntegrationCaptureRepository = new MemoryIntegrationCaptureRepository(
      environment,
    ),
    private readonly workspaceId = "local-preview",
  ) {
    if (environment === "production")
      throw new Error("Captured integration adapters are disabled in production.");
    this.key = key;
  }
  async connect(_configuration: Readonly<Record<string, string>>) {
    this.state = "captured_local";
    return this.state;
  }
  async test(_configuration: Readonly<Record<string, string>>) {
    return { state: "captured_local" as const };
  }
  async disconnect() {
    this.state = "disconnected";
  }
  async deliver(input: {
    deliveryId: string;
    payload: unknown;
    configuration: Readonly<Record<string, string>>;
  }) {
    if (this.state !== "captured_local")
      return { state: "unavailable" as const, error: "Local capture is not connected." };
    await this.captures.insertIfAbsent({
      workspaceId: this.workspaceId,
      integrationKey: this.key,
      deliveryId: input.deliveryId,
      payload: redactCapture(input.payload, "payload"),
      configuration: redactCapture(input.configuration) as Readonly<Record<string, string>>,
      createdAt: new Date().toISOString(),
    });
    return { state: "captured_local" as const };
  }
  async health() {
    return this.state;
  }
  permissions() {
    return integrationCatalog.find((item) => item.key === this.key)!.permissions;
  }
}
export class UnavailableIntegrationAdapter implements IntegrationAdapter {
  constructor(
    readonly key: IntegrationKey,
    private readonly reason = "Official credential adapter is not configured.",
  ) {}
  async connect(_configuration: Readonly<Record<string, string>>) {
    return "unavailable" as const;
  }
  async test(_configuration: Readonly<Record<string, string>>) {
    return { state: "unavailable" as const, error: this.reason };
  }
  async disconnect() {}
  async deliver(_input: {
    deliveryId: string;
    payload: unknown;
    configuration: Readonly<Record<string, string>>;
  }) {
    return { state: "unavailable" as const, error: this.reason };
  }
  async health() {
    return "unavailable" as const;
  }
  permissions() {
    return integrationCatalog.find((item) => item.key === this.key)!.permissions;
  }
}
export class SignedGenericWebhookAdapter implements IntegrationAdapter {
  readonly key = "generic_webhook" as const;
  constructor(
    private readonly transport: WebhookTransport,
    private readonly secret: string,
  ) {}
  async connect(configuration: Readonly<Record<string, string>>) {
    return /^https:\/\//.test(configuration.url ?? "")
      ? ("connected" as const)
      : ("unavailable" as const);
  }
  async test(configuration: Readonly<Record<string, string>>) {
    return this.deliver({
      deliveryId: crypto.randomUUID(),
      payload: { type: "integration.test" },
      configuration,
    });
  }
  async disconnect() {}
  async deliver(input: {
    deliveryId: string;
    payload: unknown;
    configuration: Readonly<Record<string, string>>;
  }): Promise<IntegrationResult> {
    const url = input.configuration.url;
    if (!url || !url.startsWith("https://"))
      return { state: "unavailable", error: "A HTTPS webhook URL is required." };
    const body = JSON.stringify(input.payload);
    const timestamp = Math.floor(Date.now() / 1000);
    try {
      const result = await this.transport.deliver(url, body, {
        "content-type": "application/json",
        "x-formsentinel-signature": signWebhook(body, this.secret, timestamp),
        "x-formsentinel-timestamp": String(timestamp),
        "x-formsentinel-idempotency-key": input.deliveryId,
      });
      if (result.state === "captured_local")
        return { state: "captured_local", responseCode: result.status };
      return result.status >= 200 && result.status < 300
        ? { state: "delivered", responseCode: result.status }
        : { state: "failed", responseCode: result.status, error: `HTTP ${result.status}` };
    } catch (error) {
      return {
        state: "failed",
        error: error instanceof Error ? error.message : "Webhook delivery failed.",
      };
    }
  }
  async health() {
    return "connected" as const;
  }
  permissions() {
    return integrationCatalog.find((item) => item.key === this.key)!.permissions;
  }
}
export function localIntegrationRegistry(
  environment: "development" | "test" | "production" = "development",
): ReadonlyMap<IntegrationKey, IntegrationAdapter> {
  return new Map(
    integrationKeys.map((key) => [
      key,
      environment === "production"
        ? new UnavailableIntegrationAdapter(key)
        : new CapturedLocalIntegrationAdapter(key, environment),
    ]),
  );
}
export function retryableIntegrationResult(result: IntegrationResult): boolean {
  return (
    result.state === "failed" &&
    (result.responseCode === undefined ||
      result.responseCode === 408 ||
      result.responseCode === 429 ||
      result.responseCode >= 500)
  );
}
