import { Phase3FeaturePage } from "../../../components/Phase3FeaturePage";
export const metadata = { title: "Reliability" };
export default function ReliabilityPage() {
  return (
    <Phase3FeaturePage
      title="Reliability score"
      description="A deterministic versioned formula scores health, schema stability, spam/CAPTCHA/domain configuration, delivery/files, last real submission, integration verification, and accessibility."
      status="preview"
      evidence={[
        "Every point links to component explanations and evidence IDs.",
        "Missing and unconfigured components score zero and reduce coverage; no AI-generated score is used.",
      ]}
      empty="No reliability snapshot has been calculated."
    />
  );
}
