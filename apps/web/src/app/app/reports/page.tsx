import { Phase3FeaturePage } from "../../../components/Phase3FeaturePage";
export const metadata = { title: "Reports" };
export default function ReportsPage() {
  return (
    <Phase3FeaturePage
      title="Evidence reports"
      description="Immutable private JSON, CSV, and self-contained HTML artifacts include summaries, metrics, incidents, changes, recommendations, evidence IDs, checksums, and expiry."
      status="preview"
      evidence={[
        "Downloads require exact workspace authorization and checksum verification.",
        "PDF is unavailable until a real isolated renderer is configured.",
      ]}
      empty="No report artifacts."
    />
  );
}
