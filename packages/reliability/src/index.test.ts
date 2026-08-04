import { describe, expect, it } from "vitest";
import { calculateReliability, reliabilityFormulaVersion } from "./index";
describe("reliability score", () => {
  it("is deterministic, bounded and fully explained", () => {
    const snapshot = calculateReliability({
      health: { state: "healthy", evidenceIds: ["e1"] },
      schema_stability: { state: "degraded", detail: "one open drift" },
      integration_verification: { state: "unconfigured" },
    });
    expect(snapshot).toEqual(
      calculateReliability({
        health: { state: "healthy", evidenceIds: ["e1"] },
        schema_stability: { state: "degraded", detail: "one open drift" },
        integration_verification: { state: "unconfigured" },
      }),
    );
    expect(snapshot.score).toBe(33);
    expect(snapshot.formulaVersion).toBe(reliabilityFormulaVersion);
    expect(snapshot.components).toHaveLength(7);
    expect(
      snapshot.components.find((item) => item.key === "integration_verification")?.points,
    ).toBe(0);
    expect(snapshot.evidenceIds).toEqual(["e1"]);
  });
});
