import { Phase3FeaturePage } from "../../../components/Phase3FeaturePage";
export const metadata = { title: "MCP tokens" };
export default function McpTokensPage() {
  return (
    <Phase3FeaturePage
      title="MCP access tokens"
      description="Hashed, one-time-display tokens enforce expiration, revocation, exact workspace/form grants, default-deny scopes, rate limits, and audit emission."
      status="preview"
      evidence={[
        "Default MCP scopes exclude submission access.",
        "Only synthetic test submissions can be enabled with a dedicated scope, confirmation, and idempotency key; SERVICE_TOKEN is never used for MCP users.",
      ]}
      empty="No active MCP tokens."
    />
  );
}
