import {
  PostgresBillingEventRepository,
  parseStripeEvent,
  stripeCapability,
  stripeConfigurationFromEnvironment,
  stripePayloadHash,
  verifyStripeSignature,
} from "@formsentinel/billing";
import type { PlanId } from "@formsentinel/entitlements";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const configuration = stripeConfigurationFromEnvironment();
  const capability = stripeCapability(configuration);
  if (!capability.available || !process.env.DATABASE_URL)
    return Response.json({ error: "billing_unavailable" }, { status: 503 });
  const rawBody = await request.text();
  if (
    !verifyStripeSignature(
      rawBody,
      request.headers.get("stripe-signature"),
      configuration.webhookSecret!,
    )
  )
    return Response.json({ error: "invalid_signature" }, { status: 400 });
  let event;
  try {
    event = parseStripeEvent(rawBody);
  } catch {
    return Response.json({ error: "invalid_event" }, { status: 400 });
  }
  if (event.livemode !== (configuration.mode === "live"))
    return Response.json({ error: "stripe_mode_mismatch" }, { status: 400 });
  const priceToPlan = new Map<string, PlanId>(
    Object.entries(configuration.prices).map(([plan, price]) => [price!, plan as PlanId]),
  );
  const repository = new PostgresBillingEventRepository(process.env.DATABASE_URL);
  try {
    const result = await repository.apply(event, stripePayloadHash(rawBody), priceToPlan);
    return Response.json({ received: true, result });
  } catch {
    return Response.json({ error: "billing_event_failed" }, { status: 503 });
  } finally {
    await repository.close();
  }
}
