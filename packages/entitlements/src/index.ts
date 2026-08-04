export const ENTITLEMENT_CATALOG_VERSION = "2026-08-01";

export const planIds = ["free", "starter", "pro", "agency"] as const;
export type PlanId = (typeof planIds)[number];

export const limitKeys = [
  "forms",
  "members",
  "monthlySubmissions",
  "fileBytes",
  "storageBytes",
  "retentionDays",
  "webhooks",
  "integrations",
  "apiKeys",
  "mcpCredentials",
  "reports",
  "agencyClients",
] as const;
export type LimitKey = (typeof limitKeys)[number];

export const featureKeys = [
  "fileUploads",
  "webhooks",
  "integrations",
  "api",
  "mcp",
  "reports",
  "agency",
] as const;
export type FeatureKey = (typeof featureKeys)[number];
export type LimitValue = number;

export interface PlanDefinition {
  readonly id: PlanId;
  readonly name: string;
  readonly description: string;
  readonly monthlyPriceCents: number;
  readonly limits: Readonly<Record<LimitKey, LimitValue>>;
  readonly features: Readonly<Record<FeatureKey, boolean>>;
  readonly quota: {
    readonly warningPercent: 80;
    readonly hardPercent: 100;
    readonly overagePercent: 120;
    readonly overageAllowed: boolean;
    readonly billingGraceDays: number;
  };
}

const quota = (billingGraceDays: number, overageAllowed = false) => ({
  warningPercent: 80 as const,
  hardPercent: 100 as const,
  overagePercent: 120 as const,
  overageAllowed,
  billingGraceDays,
});

export const catalog: Readonly<Record<PlanId, PlanDefinition>> = {
  free: {
    id: "free",
    name: "Free",
    description: "Local evaluation and small forms.",
    monthlyPriceCents: 0,
    limits: {
      forms: 2,
      members: 1,
      monthlySubmissions: 100,
      fileBytes: 0,
      storageBytes: 0,
      retentionDays: 30,
      webhooks: 0,
      integrations: 0,
      apiKeys: 0,
      mcpCredentials: 0,
      reports: 0,
      agencyClients: 0,
    },
    features: {
      fileUploads: false,
      webhooks: false,
      integrations: false,
      api: false,
      mcp: false,
      reports: false,
      agency: false,
    },
    quota: quota(0),
  },
  starter: {
    id: "starter",
    name: "Starter",
    description: "Small production teams with basic delivery needs.",
    monthlyPriceCents: 1_900,
    limits: {
      forms: 10,
      members: 3,
      monthlySubmissions: 1_000,
      fileBytes: 10_000_000,
      storageBytes: 1_000_000_000,
      retentionDays: 90,
      webhooks: 3,
      integrations: 3,
      apiKeys: 2,
      mcpCredentials: 0,
      reports: 3,
      agencyClients: 0,
    },
    features: {
      fileUploads: true,
      webhooks: true,
      integrations: true,
      api: true,
      mcp: false,
      reports: true,
      agency: false,
    },
    quota: quota(3),
  },
  pro: {
    id: "pro",
    name: "Pro",
    description: "Teams that need more forms, collaborators, and automation.",
    monthlyPriceCents: 4_900,
    limits: {
      forms: 50,
      members: 10,
      monthlySubmissions: 10_000,
      fileBytes: 25_000_000,
      storageBytes: 10_000_000_000,
      retentionDays: 365,
      webhooks: 20,
      integrations: 20,
      apiKeys: 10,
      mcpCredentials: 5,
      reports: 25,
      agencyClients: 0,
    },
    features: {
      fileUploads: true,
      webhooks: true,
      integrations: true,
      api: true,
      mcp: true,
      reports: true,
      agency: false,
    },
    quota: quota(7),
  },
  agency: {
    id: "agency",
    name: "Agency",
    description: "Multi-client agencies with higher scale and reporting.",
    monthlyPriceCents: 14_900,
    limits: {
      forms: 250,
      members: 50,
      monthlySubmissions: 100_000,
      fileBytes: 50_000_000,
      storageBytes: 100_000_000_000,
      retentionDays: 730,
      webhooks: 100,
      integrations: 100,
      apiKeys: 50,
      mcpCredentials: 25,
      reports: 100,
      agencyClients: 50,
    },
    features: {
      fileUploads: true,
      webhooks: true,
      integrations: true,
      api: true,
      mcp: true,
      reports: true,
      agency: true,
    },
    quota: quota(14),
  },
};

export const denialReasons = [
  "feature_not_in_plan",
  "limit_reached",
  "monthly_quota_reached",
  "workspace_restricted",
  "subscription_inactive",
  "override_expired",
] as const;
export type EntitlementDenialReason = (typeof denialReasons)[number];

export interface EntitlementOverride {
  readonly id: string;
  readonly workspaceId: string;
  readonly limit?: LimitKey;
  readonly feature?: FeatureKey;
  readonly value: number | boolean;
  readonly reason: string;
  readonly ticket: string;
  readonly actorId: string;
  readonly startsAt: Date;
  readonly expiresAt: Date;
}

export interface ResolveEntitlementInput {
  readonly plan: PlanId;
  readonly workspaceId: string;
  readonly now?: Date;
  readonly subscriptionActive?: boolean;
  readonly restricted?: boolean;
  readonly overrides?: readonly EntitlementOverride[];
}

export interface EntitlementResolution {
  readonly catalogVersion: string;
  readonly plan: PlanId;
  readonly limits: Readonly<Record<LimitKey, LimitValue>>;
  readonly features: Readonly<Record<FeatureKey, boolean>>;
  readonly appliedOverrideIds: readonly string[];
  checkLimit(key: LimitKey, used: number, requested?: number): EntitlementDecision;
  checkFeature(key: FeatureKey): EntitlementDecision;
}

export type EntitlementDecision =
  | { readonly allowed: true; readonly limit?: LimitValue; readonly remaining?: number | null }
  | {
      readonly allowed: false;
      readonly reason: EntitlementDenialReason;
      readonly limit?: LimitValue;
      readonly remaining?: number;
    };

export function resolveEntitlements(input: ResolveEntitlementInput): EntitlementResolution {
  const definition = catalog[input.plan];
  const limits: Record<LimitKey, LimitValue> = { ...definition.limits };
  const features: Record<FeatureKey, boolean> = { ...definition.features };
  const now = input.now ?? new Date();
  const appliedOverrideIds: string[] = [];
  for (const override of input.overrides ?? []) {
    if (
      override.workspaceId !== input.workspaceId ||
      override.startsAt > now ||
      override.expiresAt <= now ||
      !override.reason.trim() ||
      !override.ticket.trim() ||
      !override.actorId.trim()
    )
      continue;
    if (override.limit && typeof override.value === "number")
      limits[override.limit] = override.value;
    else if (override.feature && typeof override.value === "boolean")
      features[override.feature] = override.value;
    else continue;
    appliedOverrideIds.push(override.id);
  }
  const blockedReason = (): EntitlementDenialReason | null =>
    input.restricted
      ? "workspace_restricted"
      : input.subscriptionActive === false && input.plan !== "free"
        ? "subscription_inactive"
        : null;
  return {
    catalogVersion: ENTITLEMENT_CATALOG_VERSION,
    plan: input.plan,
    limits,
    features,
    appliedOverrideIds,
    checkLimit(key, used, requested = 1) {
      const blocked = blockedReason();
      const limit = limits[key];
      if (blocked) return { allowed: false, reason: blocked, limit, remaining: 0 };
      const remaining = limit === null ? null : Math.max(0, limit - used);
      if (limit !== null && used + requested > limit)
        return {
          allowed: false,
          reason: key === "monthlySubmissions" ? "monthly_quota_reached" : "limit_reached",
          limit,
          remaining: Math.max(0, limit - used),
        };
      return { allowed: true, limit, remaining };
    },
    checkFeature(key) {
      const blocked = blockedReason();
      if (blocked) return { allowed: false, reason: blocked };
      return features[key] ? { allowed: true } : { allowed: false, reason: "feature_not_in_plan" };
    },
  };
}

export function entitlementLimit(plan: PlanId, entitlement: LimitKey): LimitValue {
  return catalog[plan].limits[entitlement];
}
