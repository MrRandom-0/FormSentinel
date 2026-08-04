import { redactMetadata } from "@formsentinel/security";
export type RoutingScalar = string | number | boolean | null;
export type RoutingCondition =
  | {
      kind: "compare";
      field: string;
      operator:
        "eq" | "neq" | "contains" | "starts_with" | "gt" | "gte" | "lt" | "lte" | "in" | "exists";
      value?: RoutingScalar | readonly RoutingScalar[];
    }
  | { kind: "all" | "any"; conditions: readonly RoutingCondition[] }
  | { kind: "not"; condition: RoutingCondition };
export interface RoutingActions {
  recipients?: readonly string[];
  integrationIds?: readonly string[];
  tags?: readonly string[];
  skipAutoresponder?: boolean;
  skipSpam?: boolean;
}
export interface RoutingRule {
  id: string;
  name: string;
  priority: number;
  when: RoutingCondition;
  actions: RoutingActions;
  stop?: boolean;
}
export interface RoutingRuleVersion {
  id: string;
  ruleSetId: string;
  version: number;
  rules: readonly RoutingRule[];
  createdAt: string;
}
export interface RoutingLimits {
  maxDepth: number;
  maxNodes: number;
  maxString: number;
  maxList: number;
  maxTotalBytes: number;
}
const defaults: RoutingLimits = {
  maxDepth: 8,
  maxNodes: 100,
  maxString: 500,
  maxList: 50,
  maxTotalBytes: 64_000,
};
const fieldPattern = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const operators = new Set([
  "eq",
  "neq",
  "contains",
  "starts_with",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "exists",
]);
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
export function validateRoutingRules(
  rules: readonly RoutingRule[],
  limits: RoutingLimits = defaults,
): void {
  if (!Array.isArray(rules)) throw new Error("routing_invalid_rules");
  let serialized: string;
  try {
    serialized = JSON.stringify(rules);
  } catch {
    throw new Error("routing_invalid_rules");
  }
  if (new TextEncoder().encode(serialized).byteLength > limits.maxTotalBytes)
    throw new Error("routing_size_limit");
  if (rules.length > limits.maxList) throw new Error("routing_list_limit");
  let nodes = 0;
  const scalar = (value: unknown): value is RoutingScalar =>
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value));
  const visit = (input: unknown, depth: number): void => {
    const condition = record(input);
    if (!condition || typeof condition.kind !== "string")
      throw new Error("routing_invalid_condition");
    nodes += 1;
    if (nodes > limits.maxNodes) throw new Error("routing_node_limit");
    if (depth > limits.maxDepth) throw new Error("routing_depth_limit");
    if (condition.kind === "compare") {
      if (typeof condition.field !== "string" || !fieldPattern.test(condition.field))
        throw new Error("routing_invalid_field");
      if (typeof condition.operator !== "string" || !operators.has(condition.operator))
        throw new Error("routing_invalid_operator");
      const hasValue = Object.hasOwn(condition, "value");
      if (condition.operator !== "exists" && !hasValue) throw new Error("routing_value_required");
      if (condition.operator === "exists" && hasValue) throw new Error("routing_value_forbidden");
      const values = Array.isArray(condition.value) ? condition.value : [condition.value];
      if (values.length > limits.maxList) throw new Error("routing_list_limit");
      if (condition.operator === "in" && !Array.isArray(condition.value))
        throw new Error("routing_list_required");
      if (
        values.some(
          (value) =>
            !scalar(value) || (typeof value === "string" && value.length > limits.maxString),
        )
      )
        throw new Error("routing_value_limit");
      return;
    }
    if (condition.kind === "not") {
      if (!Object.hasOwn(condition, "condition")) throw new Error("routing_invalid_condition");
      visit(condition.condition, depth + 1);
      return;
    }
    if (condition.kind !== "all" && condition.kind !== "any")
      throw new Error("routing_invalid_condition");
    if (!Array.isArray(condition.conditions)) throw new Error("routing_invalid_condition");
    if (condition.conditions.length > limits.maxList) throw new Error("routing_list_limit");
    condition.conditions.forEach((item) => visit(item, depth + 1));
  };
  const ids = new Set<string>();
  for (const input of rules as readonly unknown[]) {
    const rule = record(input);
    if (!rule) throw new Error("routing_invalid_rule");
    if (typeof rule.id !== "string" || !idPattern.test(rule.id))
      throw new Error("routing_invalid_id");
    if (ids.has(rule.id)) throw new Error("routing_duplicate_rule");
    ids.add(rule.id);
    if (typeof rule.name !== "string" || !rule.name.trim() || rule.name.length > limits.maxString)
      throw new Error("routing_value_limit");
    if (
      typeof rule.priority !== "number" ||
      !Number.isFinite(rule.priority) ||
      Math.abs(rule.priority) > 1_000_000
    )
      throw new Error("routing_invalid_priority");
    if (rule.stop !== undefined && typeof rule.stop !== "boolean")
      throw new Error("routing_invalid_action");
    visit(rule.when, 1);
    const actions = record(rule.actions);
    if (!actions) throw new Error("routing_invalid_action");
    for (const key of Object.keys(actions))
      if (!["recipients", "integrationIds", "tags", "skipAutoresponder", "skipSpam"].includes(key))
        throw new Error("routing_invalid_action");
    for (const key of ["skipAutoresponder", "skipSpam"])
      if (actions[key] !== undefined && typeof actions[key] !== "boolean")
        throw new Error("routing_invalid_action");
    for (const key of ["recipients", "integrationIds", "tags"] as const) {
      const collection = actions[key];
      if (collection === undefined) continue;
      if (!Array.isArray(collection) || collection.length > limits.maxList)
        throw new Error("routing_list_limit");
      if (
        collection.some(
          (value) =>
            typeof value !== "string" ||
            !value ||
            value.length > limits.maxString ||
            /[\r\n]/.test(value),
        )
      )
        throw new Error("routing_value_limit");
      if (key !== "recipients" && collection.some((value) => !idPattern.test(value as string)))
        throw new Error("routing_invalid_id");
    }
  }
}
function compare(
  actual: unknown,
  condition: Extract<RoutingCondition, { kind: "compare" }>,
): boolean {
  const value = condition.value;
  switch (condition.operator) {
    case "exists":
      return actual !== undefined && actual !== null && actual !== "";
    case "eq":
      return actual === value;
    case "neq":
      return actual !== value;
    case "contains":
      return typeof actual === "string" && typeof value === "string" && actual.includes(value);
    case "starts_with":
      return typeof actual === "string" && typeof value === "string" && actual.startsWith(value);
    case "gt":
      return typeof actual === "number" && typeof value === "number" && actual > value;
    case "gte":
      return typeof actual === "number" && typeof value === "number" && actual >= value;
    case "lt":
      return typeof actual === "number" && typeof value === "number" && actual < value;
    case "lte":
      return typeof actual === "number" && typeof value === "number" && actual <= value;
    case "in":
      return Array.isArray(value) && value.includes(actual as RoutingScalar);
  }
}
function evaluate(
  condition: RoutingCondition,
  fields: Readonly<Record<string, RoutingScalar>>,
): boolean {
  if (condition.kind === "compare") return compare(fields[condition.field], condition);
  if (condition.kind === "not") return !evaluate(condition.condition, fields);
  return condition.kind === "all"
    ? condition.conditions.every((item) => evaluate(item, fields))
    : condition.conditions.some((item) => evaluate(item, fields));
}
export interface RoutingDecision {
  matchedRuleIds: readonly string[];
  recipients: readonly string[];
  integrationIds: readonly string[];
  tags: readonly string[];
  skipAutoresponder: boolean;
  skipSpam: boolean;
  evidence: unknown;
  conflicts: readonly string[];
}
export function evaluateRouting(
  rules: readonly RoutingRule[],
  fields: Readonly<Record<string, RoutingScalar>>,
  options: { spam?: boolean; synthetic?: boolean } = {},
): RoutingDecision {
  validateRoutingRules(rules);
  const matched: RoutingRule[] = [];
  for (const rule of [...rules].sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id)))
    if (evaluate(rule.when, fields)) {
      matched.push(rule);
      if (rule.stop) break;
    }
  const recipients = [...new Set(matched.flatMap((rule) => rule.actions.recipients ?? []))];
  const integrationIds = options.synthetic
    ? []
    : [...new Set(matched.flatMap((rule) => rule.actions.integrationIds ?? []))];
  const tags = [...new Set(matched.flatMap((rule) => rule.actions.tags ?? []))];
  const conflicts: string[] = [];
  const skipValues = new Set(
    matched.map((rule) => rule.actions.skipAutoresponder).filter((value) => value !== undefined),
  );
  if (skipValues.size > 1) conflicts.push("autoresponder_conflict");
  if (matched.some((rule) => rule.actions.integrationIds?.includes(rule.id)))
    conflicts.push("integration_loop");
  return {
    matchedRuleIds: matched.map((rule) => rule.id),
    recipients,
    integrationIds,
    tags,
    skipAutoresponder:
      options.synthetic || matched.some((rule) => rule.actions.skipAutoresponder === true),
    skipSpam: Boolean(options.spam) || matched.some((rule) => rule.actions.skipSpam === true),
    evidence: redactMetadata({
      evaluatedFields: Object.keys(fields),
      matched: matched.map((rule) => rule.id),
    }),
    conflicts,
  };
}
export function dryRunRouting(
  rules: readonly RoutingRule[],
  fields: Readonly<Record<string, RoutingScalar>>,
  options?: { spam?: boolean; synthetic?: boolean },
): RoutingDecision {
  return evaluateRouting(rules, fields, options);
}

export interface RoutingWorkerRepository {
  loadRuleVersion(ruleVersionId: string): Promise<RoutingRuleVersion | null>;
  loadSubmission(submissionId: string): Promise<{
    fields: Readonly<Record<string, RoutingScalar>>;
    spam: boolean;
    synthetic: boolean;
  } | null>;
  saveDecisionIfAbsent(input: {
    submissionId: string;
    ruleVersionId: string;
    idempotencyKey: string;
    decision: RoutingDecision;
  }): Promise<boolean>;
  applyActions(submissionId: string, decision: RoutingDecision): Promise<void>;
}
export function routingJobHandler(repository: RoutingWorkerRepository) {
  return async (ids: Readonly<Record<string, string>>): Promise<void> => {
    const submissionId = ids.submissionId;
    const ruleVersionId = ids.ruleVersionId;
    if (!submissionId || !ruleVersionId) throw new Error("routing_ids_required");
    const [version, submission] = await Promise.all([
      repository.loadRuleVersion(ruleVersionId),
      repository.loadSubmission(submissionId),
    ]);
    if (!version || !submission) throw new Error("routing_input_not_found");
    const decision = evaluateRouting(version.rules, submission.fields, {
      spam: submission.spam,
      synthetic: submission.synthetic,
    });
    const created = await repository.saveDecisionIfAbsent({
      submissionId,
      ruleVersionId,
      idempotencyKey: `routing:${submissionId}:${ruleVersionId}`,
      decision,
    });
    if (created) await repository.applyActions(submissionId, decision);
  };
}
