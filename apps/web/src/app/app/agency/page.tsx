import { Phase3FeaturePage } from "../../../components/Phase3FeaturePage";
export const metadata = { title: "Agency" };
export default function AgencyPage() {
  return (
    <Phase3FeaturePage
      title="Agency mode"
      description="Explicit agency membership and per-client workspace grants support aggregate health, branding, viewer access, templates, alerts, and white-label reports without weakening workspace isolation."
      status="preview"
      evidence={[
        "Cross-client access is default-deny.",
        "Reusable form, monitor, and routing templates include versioned definitions and usage notes.",
      ]}
      empty="No client workspaces have been granted."
    />
  );
}
