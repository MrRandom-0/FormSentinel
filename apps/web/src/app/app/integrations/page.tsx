import { Phase3FeaturePage } from "../../../components/Phase3FeaturePage";
export const metadata = { title: "Integrations" };
export default function IntegrationsPage() {
  return (
    <Phase3FeaturePage
      title="Integrations"
      description="Slack, Discord, Telegram, Google Sheets, Notion, Airtable, Zapier, Make, generic webhook, and email use explicit lifecycle and health states."
      status="preview"
      evidence={[
        "Every named provider has honest captured_local behavior during development.",
        "Official providers remain unavailable without credential adapters; signed generic webhooks use the safe transport.",
      ]}
      empty="No integration connections."
    />
  );
}
