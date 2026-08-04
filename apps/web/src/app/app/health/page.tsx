import { Phase3FeaturePage } from "../../../components/Phase3FeaturePage";
export const metadata = { title: "Health and incidents" };
export default function HealthPage() {
  return (
    <Phase3FeaturePage
      title="Health timeline and incidents"
      description="Manual and scheduled static checks produce immutable step evidence, synthetic suppression, incident thresholds, and recovery events."
      status="preview"
      evidence={[
        "Hourly, 6-hour, daily, weekly, manual, and deployment schedules are represented.",
        "Email, webhook, and Slack alerts are captured locally; official delivery is unavailable without credentials.",
      ]}
      empty="No monitor runs or incidents yet."
    />
  );
}
