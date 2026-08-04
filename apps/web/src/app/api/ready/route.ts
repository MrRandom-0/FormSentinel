import { stripeCapability, stripeConfigurationFromEnvironment } from "@formsentinel/billing";

export function GET() {
  const production = process.env.NODE_ENV === "production";
  const billing = stripeCapability(stripeConfigurationFromEnvironment());
  const body = {
    status: production ? "not_ready" : "ready_local_preview",
    service: "web",
    hostedProductionReady: false,
    required: {
      controlPlane: {
        ready: false,
        reason: "postgres_web_auth_control_plane_not_implemented",
      },
    },
    capabilities: {
      billing,
      managedObjectStorage: { available: false, reason: "adapter_not_implemented" },
      managedKms: { available: false, reason: "adapter_not_implemented" },
      malwareScanning: { available: false, reason: "adapter_not_implemented" },
      platformAdmin: { available: false, reason: "operator_idp_mfa_not_configured" },
      browserAccessibility: { available: false, reason: "browser_runtime_not_verified" },
    },
  };
  return Response.json(body, { status: production ? 503 : 200 });
}
