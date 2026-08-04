import {
  PostgresBillingEventRepository,
  StripeBillingProvider,
  stripeConfigurationFromEnvironment,
} from "@formsentinel/billing";
import { repository } from "../../../../lib/repository";
import { requireSession } from "../../../../lib/session";

export async function POST(request: Request) {
  const session = await requireSession();
  const workspace = await repository.getCurrentWorkspace(session.userId);
  if (!workspace) return Response.json({ error: "not_found" }, { status: 404 });
  await repository.requireAccess(session.userId, workspace.id, "billing:manage");
  if (!process.env.DATABASE_URL)
    return Response.json({ error: "billing_mirror_unavailable" }, { status: 503 });
  const input = (await request.json()) as { returnUrl?: string };
  if (!input.returnUrl) return Response.json({ error: "invalid_request" }, { status: 400 });
  const provider = new StripeBillingProvider(stripeConfigurationFromEnvironment());
  if (!provider.capability.available)
    return Response.json(
      { error: "billing_unavailable", reason: provider.capability.reason },
      { status: 503 },
    );
  const billing = new PostgresBillingEventRepository(process.env.DATABASE_URL);
  try {
    const mirror = await billing.getMirror(workspace.id);
    if (!mirror?.customerId)
      return Response.json({ error: "billing_customer_unavailable" }, { status: 409 });
    return Response.json(
      await provider.createPortal({ customerId: mirror.customerId, returnUrl: input.returnUrl }),
    );
  } catch {
    return Response.json({ error: "billing_provider_failed" }, { status: 502 });
  } finally {
    await billing.close();
  }
}
