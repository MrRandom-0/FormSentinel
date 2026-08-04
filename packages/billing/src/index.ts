import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { planIds, type PlanId } from "@formsentinel/entitlements";

export const supportedStripeEvents = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const;
export type SupportedStripeEvent = (typeof supportedStripeEvents)[number];
export interface StripeEventEnvelope {
  readonly id: string;
  readonly type: string;
  readonly created: number;
  readonly livemode: boolean;
  readonly data: { readonly object: Record<string, unknown> };
}
export interface BillingMirror {
  readonly workspaceId: string;
  readonly customerId: string | null;
  readonly subscriptionId: string | null;
  readonly plan: PlanId;
  readonly status: string;
  readonly periodEndsAt: string | null;
  readonly graceEndsAt: string | null;
  readonly lastEventCreated: number;
}
export type BillingEventResult =
  "processed" | "duplicate" | "ignored_unknown" | "ignored_out_of_order";
export interface BillingEventRepository {
  apply(
    event: StripeEventEnvelope,
    payloadHash: string,
    priceToPlan: ReadonlyMap<string, PlanId>,
  ): Promise<BillingEventResult>;
}

export interface StripeConfiguration {
  readonly mode: "test" | "live";
  readonly secretKey?: string;
  readonly webhookSecret?: string;
  readonly prices: Partial<Record<Exclude<PlanId, "free">, string>>;
  readonly allowedReturnOrigins: readonly string[];
}
export function stripeConfigurationFromEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): StripeConfiguration {
  const prices: Partial<Record<Exclude<PlanId, "free">, string>> = {};
  if (source.STRIPE_PRICE_STARTER) prices.starter = source.STRIPE_PRICE_STARTER;
  if (source.STRIPE_PRICE_PRO) prices.pro = source.STRIPE_PRICE_PRO;
  if (source.STRIPE_PRICE_AGENCY) prices.agency = source.STRIPE_PRICE_AGENCY;
  return {
    mode: source.STRIPE_MODE === "live" ? "live" : "test",
    ...(source.STRIPE_SECRET_KEY ? { secretKey: source.STRIPE_SECRET_KEY } : {}),
    ...(source.STRIPE_WEBHOOK_SECRET ? { webhookSecret: source.STRIPE_WEBHOOK_SECRET } : {}),
    prices,
    allowedReturnOrigins: (source.BILLING_RETURN_ORIGINS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  };
}
export type BillingCapability =
  | { readonly available: true; readonly mode: "test" | "live" }
  | { readonly available: false; readonly reason: string };
export function stripeCapability(configuration: StripeConfiguration): BillingCapability {
  const expectedPrefix = configuration.mode === "live" ? "sk_live_" : "sk_test_";
  if (!configuration.secretKey?.startsWith(expectedPrefix))
    return { available: false, reason: "stripe_key_missing_or_mode_mismatch" };
  if (!configuration.webhookSecret?.startsWith("whsec_"))
    return { available: false, reason: "stripe_webhook_secret_missing" };
  if (planIds.slice(1).some((plan) => !configuration.prices[plan as Exclude<PlanId, "free">]))
    return { available: false, reason: "stripe_price_mapping_incomplete" };
  if (!configuration.allowedReturnOrigins.length)
    return { available: false, reason: "billing_return_allowlist_empty" };
  return { available: true, mode: configuration.mode };
}
export function allowedReturnUrl(value: string, origins: readonly string[]): string {
  const url = new URL(value);
  if (url.username || url.password || !origins.includes(url.origin))
    throw new Error("billing_return_url_not_allowed");
  return url.href;
}

export function verifyStripeSignature(
  rawBody: string | Uint8Array,
  signatureHeader: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): boolean {
  if (!signatureHeader || !secret.startsWith("whsec_")) return false;
  const values = signatureHeader
    .split(",")
    .map((part) => part.trim().split("=", 2) as [string, string]);
  const timestampText = values.find(([key]) => key === "t")?.[1];
  const signatures = values.filter(([key]) => key === "v1").map(([, value]) => value);
  const timestamp = Number(timestampText);
  if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > toleranceSeconds)
    return false;
  const body = typeof rawBody === "string" ? rawBody : Buffer.from(rawBody).toString("utf8");
  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest();
  return signatures.some((candidate) => {
    if (!/^[a-f\d]{64}$/i.test(candidate)) return false;
    const actual = Buffer.from(candidate, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}
export const stripePayloadHash = (rawBody: string | Uint8Array): string =>
  createHash("sha256").update(rawBody).digest("hex");
export function parseStripeEvent(rawBody: string): StripeEventEnvelope {
  const value = JSON.parse(rawBody) as Partial<StripeEventEnvelope>;
  if (
    typeof value.id !== "string" ||
    typeof value.type !== "string" ||
    !Number.isSafeInteger(value.created) ||
    typeof value.livemode !== "boolean" ||
    !value.data ||
    typeof value.data.object !== "object" ||
    !value.data.object
  )
    throw new Error("invalid_stripe_event");
  return value as StripeEventEnvelope;
}
const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const metadataWorkspace = (object: Record<string, unknown>): string | null => {
  const metadata = object.metadata;
  return metadata && typeof metadata === "object"
    ? text((metadata as Record<string, unknown>).workspace_id)
    : null;
};
const priceId = (object: Record<string, unknown>): string | null => {
  const items = (object.items as { data?: { price?: { id?: unknown } }[] } | undefined)?.data;
  return text(items?.[0]?.price?.id) ?? text(object.price_id);
};
function normalizedMirror(
  event: StripeEventEnvelope,
  priceToPlan: ReadonlyMap<string, PlanId>,
  current?: BillingMirror,
): BillingMirror | null {
  const object = event.data.object;
  const workspaceId = metadataWorkspace(object) ?? current?.workspaceId ?? null;
  if (!workspaceId) return null;
  const mappedPlan = priceToPlan.get(priceId(object) ?? "") ?? current?.plan ?? "free";
  const customerId = text(object.customer) ?? current?.customerId ?? null;
  const subscriptionId =
    event.type === "checkout.session.completed"
      ? text(object.subscription)
      : (text(object.id) ?? current?.subscriptionId ?? null);
  let status = text(object.status) ?? current?.status ?? "incomplete";
  if (event.type === "invoice.paid") status = "active";
  if (event.type === "invoice.payment_failed") status = "past_due";
  if (event.type === "customer.subscription.deleted") status = "canceled";
  const periodEnd = number(object.current_period_end);
  const graceDays =
    mappedPlan === "agency" ? 14 : mappedPlan === "pro" ? 7 : mappedPlan === "starter" ? 3 : 0;
  const graceEndsAt =
    status === "past_due"
      ? new Date((event.created + graceDays * 86_400) * 1000).toISOString()
      : null;
  return {
    workspaceId,
    customerId,
    subscriptionId,
    plan: status === "canceled" ? "free" : mappedPlan,
    status,
    periodEndsAt: periodEnd
      ? new Date(periodEnd * 1000).toISOString()
      : (current?.periodEndsAt ?? null),
    graceEndsAt,
    lastEventCreated: event.created,
  };
}

export class MemoryBillingEventRepository implements BillingEventRepository {
  readonly events = new Map<string, { hash: string; result: BillingEventResult }>();
  readonly mirrors = new Map<string, BillingMirror>();
  constructor(environment: "development" | "test" | "production" = "development") {
    if (environment === "production") throw new Error("Memory billing is disabled in production.");
  }
  async apply(
    event: StripeEventEnvelope,
    payloadHash: string,
    priceToPlan: ReadonlyMap<string, PlanId>,
  ): Promise<BillingEventResult> {
    if (this.events.has(event.id)) return "duplicate";
    if (!supportedStripeEvents.includes(event.type as SupportedStripeEvent)) {
      this.events.set(event.id, { hash: payloadHash, result: "ignored_unknown" });
      return "ignored_unknown";
    }
    const workspaceId = metadataWorkspace(event.data.object);
    const current = workspaceId ? this.mirrors.get(workspaceId) : undefined;
    if (current && event.created < current.lastEventCreated) {
      this.events.set(event.id, { hash: payloadHash, result: "ignored_out_of_order" });
      return "ignored_out_of_order";
    }
    const mirror = normalizedMirror(event, priceToPlan, current);
    if (mirror) this.mirrors.set(mirror.workspaceId, mirror);
    this.events.set(event.id, { hash: payloadHash, result: "processed" });
    return "processed";
  }
}

export class PostgresBillingEventRepository implements BillingEventRepository {
  readonly pool: Pool;
  constructor(connection: string | Pool) {
    this.pool =
      typeof connection === "string" ? new Pool({ connectionString: connection }) : connection;
  }
  async close() {
    await this.pool.end();
  }
  async getMirror(workspaceId: string): Promise<BillingMirror | null> {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM subscriptions WHERE workspace_id=$1",
      [workspaceId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return this.mirrorFromRow(workspaceId, row);
  }
  async apply(
    event: StripeEventEnvelope,
    payloadHash: string,
    priceToPlan: ReadonlyMap<string, PlanId>,
  ): Promise<BillingEventResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const inserted = await client.query(
        "INSERT INTO stripe_events (provider_event_id,event_type,payload_hash,provider_created_at,livemode,status) VALUES ($1,$2,$3,to_timestamp($4),$5,'received') ON CONFLICT (provider_event_id) DO NOTHING RETURNING id",
        [event.id, event.type, payloadHash, event.created, event.livemode],
      );
      if (!inserted.rowCount) {
        await client.query("COMMIT");
        return "duplicate";
      }
      if (!supportedStripeEvents.includes(event.type as SupportedStripeEvent)) {
        await client.query(
          "UPDATE stripe_events SET status='ignored_unknown',processed_at=now() WHERE provider_event_id=$1",
          [event.id],
        );
        await client.query("COMMIT");
        return "ignored_unknown";
      }
      const workspaceId = metadataWorkspace(event.data.object);
      const current = workspaceId ? await this.current(client, workspaceId) : undefined;
      if (current && event.created < current.lastEventCreated) {
        await client.query(
          "UPDATE stripe_events SET status='ignored_out_of_order',workspace_id=$2,processed_at=now() WHERE provider_event_id=$1",
          [event.id, workspaceId],
        );
        await client.query("COMMIT");
        return "ignored_out_of_order";
      }
      const mirror = normalizedMirror(event, priceToPlan, current);
      if (mirror) {
        await client.query(
          `INSERT INTO subscriptions (workspace_id,provider,provider_customer_id,provider_subscription_id,plan,status,period_ends_at,grace_ends_at,last_event_created_at,provider_updated_at) VALUES ($1,'stripe',$2,$3,$4,$5,$6,$7,to_timestamp($8),now()) ON CONFLICT (workspace_id) DO UPDATE SET provider_customer_id=COALESCE(EXCLUDED.provider_customer_id,subscriptions.provider_customer_id),provider_subscription_id=COALESCE(EXCLUDED.provider_subscription_id,subscriptions.provider_subscription_id),plan=EXCLUDED.plan,status=EXCLUDED.status,period_ends_at=EXCLUDED.period_ends_at,grace_ends_at=EXCLUDED.grace_ends_at,last_event_created_at=EXCLUDED.last_event_created_at,provider_updated_at=now(),updated_at=now()`,
          [
            mirror.workspaceId,
            mirror.customerId,
            mirror.subscriptionId,
            mirror.plan,
            mirror.status,
            mirror.periodEndsAt,
            mirror.graceEndsAt,
            mirror.lastEventCreated,
          ],
        );
        await client.query(
          "INSERT INTO audit_logs (workspace_id,actor_user_id,action,target_type,target_id,metadata) VALUES ($1,NULL,'billing.stripe_event','subscription',$2,$3)",
          [
            mirror.workspaceId,
            mirror.subscriptionId,
            { eventId: event.id, eventType: event.type, status: mirror.status },
          ],
        );
        await client.query(
          "UPDATE stripe_events SET status='processed',workspace_id=$2,processed_at=now() WHERE provider_event_id=$1",
          [event.id, mirror.workspaceId],
        );
      } else
        await client.query(
          "UPDATE stripe_events SET status='processed_unlinked',processed_at=now() WHERE provider_event_id=$1",
          [event.id],
        );
      await client.query("COMMIT");
      return "processed";
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async current(
    client: PoolClient,
    workspaceId: string,
  ): Promise<BillingMirror | undefined> {
    const result = await client.query<Record<string, unknown>>(
      "SELECT * FROM subscriptions WHERE workspace_id=$1 FOR UPDATE",
      [workspaceId],
    );
    const row = result.rows[0];
    return row ? this.mirrorFromRow(workspaceId, row) : undefined;
  }
  private mirrorFromRow(workspaceId: string, row: Record<string, unknown>): BillingMirror {
    return {
      workspaceId,
      customerId: text(row.provider_customer_id),
      subscriptionId: text(row.provider_subscription_id),
      plan: row.plan as PlanId,
      status: String(row.status),
      periodEndsAt: row.period_ends_at instanceof Date ? row.period_ends_at.toISOString() : null,
      graceEndsAt: row.grace_ends_at instanceof Date ? row.grace_ends_at.toISOString() : null,
      lastEventCreated:
        row.last_event_created_at instanceof Date
          ? Math.floor(row.last_event_created_at.getTime() / 1000)
          : 0,
    };
  }
}

export class StripeBillingProvider {
  readonly capability: BillingCapability;
  constructor(
    readonly configuration: StripeConfiguration,
    private readonly request: typeof fetch = fetch,
  ) {
    this.capability = stripeCapability(configuration);
  }
  private assertAvailable() {
    if (!this.capability.available) throw new Error(`stripe_unavailable:${this.capability.reason}`);
  }
  async createCheckout(input: {
    workspaceId: string;
    plan: Exclude<PlanId, "free">;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ url: string }> {
    this.assertAvailable();
    const price = this.configuration.prices[input.plan];
    if (!price) throw new Error("stripe_price_not_configured");
    const body = new URLSearchParams({
      mode: "subscription",
      success_url: allowedReturnUrl(input.successUrl, this.configuration.allowedReturnOrigins),
      cancel_url: allowedReturnUrl(input.cancelUrl, this.configuration.allowedReturnOrigins),
      "line_items[0][price]": price,
      "line_items[0][quantity]": "1",
      "subscription_data[metadata][workspace_id]": input.workspaceId,
      "metadata[workspace_id]": input.workspaceId,
    });
    return this.post("checkout/sessions", body);
  }
  async createPortal(input: { customerId: string; returnUrl: string }): Promise<{ url: string }> {
    this.assertAvailable();
    return this.post(
      "billing_portal/sessions",
      new URLSearchParams({
        customer: input.customerId,
        return_url: allowedReturnUrl(input.returnUrl, this.configuration.allowedReturnOrigins),
      }),
    );
  }
  private async post(path: string, body: URLSearchParams): Promise<{ url: string }> {
    const response = await this.request(`https://api.stripe.com/v1/${path}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.configuration.secretKey}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const value = (await response.json()) as { url?: unknown; error?: { message?: unknown } };
    if (!response.ok || typeof value.url !== "string")
      throw new Error("stripe_provider_request_failed");
    return { url: value.url };
  }
}

export interface BillingReconciliationWorker {
  reconcileWorkspace(workspaceId: string): Promise<"synchronized" | "unavailable">;
}
