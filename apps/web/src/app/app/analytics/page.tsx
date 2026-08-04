import { Phase3FeaturePage } from "../../../components/Phase3FeaturePage";
export const metadata = { title: "Analytics" };
export default function AnalyticsPage() {
  return (
    <Phase3FeaturePage
      title="Privacy-safe analytics"
      description="Strictly allowlisted operational and consent-gated conversion events aggregate without payloads, email addresses, raw IPs, tokens, or arbitrary metadata."
      status="preview"
      evidence={[
        "Conversion tracking is disabled unless analytics consent is present.",
        "Attribution tokens are short-lived and single-use; event retention and form deletion are supported.",
      ]}
      empty="No aggregate events in this period."
    />
  );
}
