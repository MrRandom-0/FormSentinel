import { StripeBillingProvider, stripeConfigurationFromEnvironment } from "@formsentinel/billing";
import type { PlanId } from "@formsentinel/entitlements";
import { repository } from "../../../../lib/repository";
import { requireSession } from "../../../../lib/session";

const paidPlans = new Set<PlanId>(["starter", "pro", "agency"]);

export async function POST(request: Request) {
  const session = await requireSession();
  const workspace = await repository.getCurrentWorkspace(session.userId);
  if (!workspace) return Response.json({ error: "not_found" }, { status: 404 });
  await repository.requireAccess(session.userId, workspace.id, "billing:manage");
  if (Number(request.headers.get("content-length") ?? 0) > 4_096)
    return Response.json({ error: "request_too_large" }, { status: 413 });
  const input = (await request.json()) as {
    plan?: PlanId;
    successUrl?: string;
    cancelUrl?: string;
  };
  if (!input.plan || !paidPlans.has(input.plan) || !input.successUrl || !input.cancelUrl)
    return Response.json({ error: "invalid_request" }, { status: 400 });
  const provider = new StripeBillingProvider(stripeConfigurationFromEnvironment());
  if (!provider.capability.available)
    return Response.json(
      { error: "billing_unavailable", reason: provider.capability.reason },
      { status: 503 },
    );
  try {
    const result = await provider.createCheckout({
      workspaceId: workspace.id,
      plan: input.plan as Exclude<PlanId, "free">,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    });
    return Response.json(result);
  } catch {
    return Response.json({ error: "billing_provider_failed" }, { status: 502 });
  }
}
