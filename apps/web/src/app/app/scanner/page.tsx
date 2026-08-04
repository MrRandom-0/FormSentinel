import { Phase3FeaturePage } from "../../../components/Phase3FeaturePage";
export const metadata = { title: "Static scanner" };
export default function ScannerPage() {
  return (
    <Phase3FeaturePage
      title="Static scanner"
      description="Bounded HTTP(S) static form inspection with DNS and redirect revalidation."
      status="preview"
      evidence={[
        "Private, loopback, link-local, metadata, reserved, and unsafe-port targets are rejected.",
        "Browser-rendered checks remain explicitly unavailable until an isolated browser runtime is configured.",
      ]}
      empty="No scanner runs yet."
    />
  );
}
