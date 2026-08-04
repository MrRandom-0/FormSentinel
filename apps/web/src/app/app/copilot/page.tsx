import { Phase3FeaturePage } from "../../../components/Phase3FeaturePage";
export const metadata = { title: "Integration Copilot" };
export default function CopilotPage() {
  return (
    <Phase3FeaturePage
      title="Integration Copilot"
      description="Deterministic lexical HTML and JavaScript-family heuristics, minimal patches, and builder repair prompts. Source is inspected and never executed."
      status="preview"
      evidence={[
        "Findings include lexical-heuristic provenance, confidence, and explicit unsupported coverage; they are not runtime facts.",
        "Prompts include registered endpoint, fields, origins, accessibility, states, tests, redaction, and provenance.",
      ]}
      empty="Analyze source to create findings."
    />
  );
}
