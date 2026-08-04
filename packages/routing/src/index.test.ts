import { describe, expect, it, vi } from "vitest";
import {
  dryRunRouting,
  routingJobHandler,
  validateRoutingRules,
  type RoutingCondition,
  type RoutingRule,
} from "./index";
const rule: RoutingRule = {
  id: "r1",
  name: "Sales",
  priority: 1,
  when: { kind: "compare", field: "topic", operator: "eq", value: "sales" },
  actions: {
    recipients: ["sales@example.test"],
    integrationIds: ["slack"],
    tags: ["sales"],
    skipAutoresponder: true,
  },
};
describe("routing", () => {
  it("evaluates deterministic typed rules and suppresses synthetic integrations", () => {
    expect(dryRunRouting([rule], { topic: "sales" })).toMatchObject({
      matchedRuleIds: ["r1"],
      integrationIds: ["slack"],
      skipAutoresponder: true,
    });
    expect(dryRunRouting([rule], { topic: "sales" }, { synthetic: true }).integrationIds).toEqual(
      [],
    );
  });
  it("bounds depth/nodes and detects conflicts/loops", () => {
    let condition: RoutingCondition = { kind: "compare", field: "x", operator: "exists" };
    for (let index = 0; index < 10; index += 1) condition = { kind: "not", condition };
    expect(() => validateRoutingRules([{ ...rule, when: condition }])).toThrow("depth");
    const result = dryRunRouting(
      [
        rule,
        {
          ...rule,
          id: "slack",
          priority: 2,
          actions: { integrationIds: ["slack"], skipAutoresponder: false },
        },
      ],
      { topic: "sales" },
    );
    expect(result.conflicts).toEqual(
      expect.arrayContaining(["autoresponder_conflict", "integration_loop"]),
    );
  });
  it("rejects malformed variants, values, priorities, and oversized ASTs", () => {
    expect(() =>
      validateRoutingRules([{ ...rule, when: { kind: "xor", conditions: [] } } as never]),
    ).toThrow("invalid_condition");
    expect(() =>
      validateRoutingRules([
        { ...rule, when: { kind: "compare", field: "x", operator: "bogus", value: 1 } } as never,
      ]),
    ).toThrow("invalid_operator");
    expect(() => validateRoutingRules([{ ...rule, priority: Number.NaN }])).toThrow(
      "invalid_priority",
    );
    expect(() =>
      validateRoutingRules([
        { ...rule, actions: { ...rule.actions, integrationIds: ["x".repeat(600)] } },
      ]),
    ).toThrow("value_limit");
    expect(() => validateRoutingRules([{ ...rule, name: "x".repeat(70_000) }])).toThrow(
      "size_limit",
    );
  });
  it("applies worker decisions exactly once", async () => {
    const applyActions = vi.fn(async () => undefined);
    let saved = false;
    const handler = routingJobHandler({
      loadRuleVersion: async () => ({
        id: "v1",
        ruleSetId: "set1",
        version: 1,
        rules: [rule],
        createdAt: new Date(0).toISOString(),
      }),
      loadSubmission: async () => ({
        fields: { topic: "sales" },
        spam: false,
        synthetic: false,
      }),
      saveDecisionIfAbsent: async () => {
        if (saved) return false;
        saved = true;
        return true;
      },
      applyActions,
    });
    await handler({ submissionId: "s1", ruleVersionId: "v1" });
    await handler({ submissionId: "s1", ruleVersionId: "v1" });
    expect(applyActions).toHaveBeenCalledTimes(1);
  });
});
