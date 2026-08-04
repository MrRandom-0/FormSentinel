import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  MemoryBillingEventRepository,
  allowedReturnUrl,
  stripeCapability,
  stripePayloadHash,
  verifyStripeSignature,
  type StripeEventEnvelope,
} from "./index";
const secret = "whsec_test_secret";
const event = (
  id: string,
  created: number,
  type = "customer.subscription.updated",
): StripeEventEnvelope => ({
  id,
  type,
  created,
  livemode: false,
  data: {
    object: {
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      price_id: "price_pro",
      metadata: { workspace_id: "w1" },
    },
  },
});
describe("Stripe billing", () => {
  it("verifies timestamped raw-body signatures and rejects stale/tampered bodies", () => {
    const body = JSON.stringify(event("evt_1", 1000));
    const signature = createHmac("sha256", secret).update(`1000.${body}`).digest("hex");
    const header = `t=1000,v1=${signature}`;
    expect(verifyStripeSignature(body, header, secret, 1000)).toBe(true);
    expect(verifyStripeSignature(`${body} `, header, secret, 1000)).toBe(false);
    expect(verifyStripeSignature(body, header, secret, 1400)).toBe(false);
  });
  it("deduplicates IDs, persists unknown events, and ignores out-of-order mirrors", async () => {
    const repository = new MemoryBillingEventRepository("test");
    const prices = new Map([["price_pro", "pro" as const]]);
    const newest = event("evt_new", 2000);
    expect(await repository.apply(newest, stripePayloadHash("new"), prices)).toBe("processed");
    expect(await repository.apply(newest, stripePayloadHash("new"), prices)).toBe("duplicate");
    expect(await repository.apply(event("evt_old", 1000), stripePayloadHash("old"), prices)).toBe(
      "ignored_out_of_order",
    );
    expect(
      await repository.apply(
        event("evt_unknown", 3000, "future.event"),
        stripePayloadHash("unknown"),
        prices,
      ),
    ).toBe("ignored_unknown");
    expect(repository.mirrors.get("w1")?.lastEventCreated).toBe(2000);
  });
  it("requires a complete mode-matched configuration and return allowlist", () => {
    expect(
      stripeCapability({
        mode: "live",
        secretKey: "sk_test_x",
        webhookSecret: secret,
        prices: { starter: "a", pro: "b", agency: "c" },
        allowedReturnOrigins: ["https://app.example"],
      }),
    ).toMatchObject({ available: false });
    expect(() => allowedReturnUrl("https://evil.example/path", ["https://app.example"])).toThrow(
      /not_allowed/,
    );
  });
  it("refuses memory billing in production", () => {
    expect(() => new MemoryBillingEventRepository("production")).toThrow(/disabled in production/);
  });
});
