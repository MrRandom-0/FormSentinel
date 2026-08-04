import { Phase3FeaturePage } from "../../../components/Phase3FeaturePage";
export const metadata = { title: "Routing" };
export default function RoutingPage() {
  return (
    <Phase3FeaturePage
      title="Visual routing"
      description="A bounded typed AST routes recipients, integrations, and tags without arbitrary JavaScript, network access, secret interpolation, or unsafe regular expressions."
      status="preview"
      evidence={[
        "Dry runs expose matched rules and redacted evidence.",
        "Conflicts, loops, spam suppression, synthetic suppression, and immutable versions are explicit.",
      ]}
      empty="No active routing rule version."
    />
  );
}
