export const reliabilityFormulaVersion = "3.0.0";
export type ReliabilityComponentKey =
  | "health"
  | "schema_stability"
  | "spam_captcha_domain"
  | "notifications_webhooks_files"
  | "last_real_submission"
  | "integration_verification"
  | "accessibility";
export interface ReliabilityInput {
  state: "healthy" | "degraded" | "failed" | "missing" | "unconfigured";
  evidenceIds?: readonly string[];
  detail?: string;
}
export interface ReliabilityComponent {
  key: ReliabilityComponentKey;
  weight: number;
  points: number;
  state: ReliabilityInput["state"];
  evidenceIds: readonly string[];
  explanation: string;
  covered: boolean;
}
export interface ReliabilitySnapshot {
  score: number;
  formulaVersion: string;
  coverage: number;
  components: readonly ReliabilityComponent[];
  evidenceIds: readonly string[];
}
const weights: Record<ReliabilityComponentKey, number> = {
  health: 25,
  schema_stability: 15,
  spam_captcha_domain: 15,
  notifications_webhooks_files: 15,
  last_real_submission: 10,
  integration_verification: 10,
  accessibility: 10,
};
const factor: Record<ReliabilityInput["state"], number> = {
  healthy: 1,
  degraded: 0.5,
  failed: 0,
  missing: 0,
  unconfigured: 0,
};
export function calculateReliability(
  inputs: Readonly<Partial<Record<ReliabilityComponentKey, ReliabilityInput>>>,
): ReliabilitySnapshot {
  const components = (Object.keys(weights) as ReliabilityComponentKey[]).map((key) => {
    const input = inputs[key] ?? { state: "missing" as const };
    const weight = weights[key];
    const points = Math.round(weight * factor[input.state] * 100) / 100;
    return {
      key,
      weight,
      points,
      state: input.state,
      evidenceIds: [...(input.evidenceIds ?? [])],
      explanation:
        input.detail ??
        (input.state === "missing"
          ? "No evidence was collected; this component is not healthy."
          : input.state === "unconfigured"
            ? "This component is unconfigured and does not count as healthy."
            : `${key} is ${input.state}.`),
      covered: input.state !== "missing" && input.state !== "unconfigured",
    };
  });
  const evidenceIds = [...new Set(components.flatMap((item) => item.evidenceIds))];
  return {
    score: Math.max(
      0,
      Math.min(100, Math.round(components.reduce((sum, item) => sum + item.points, 0))),
    ),
    formulaVersion: reliabilityFormulaVersion,
    coverage: Math.round(
      (components.filter((item) => item.covered).reduce((sum, item) => sum + item.weight, 0) /
        100) *
        100,
    ),
    components,
    evidenceIds,
  };
}
