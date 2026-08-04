export const appRoutes = [
  "app",
  "app/forms",
  "app/submissions",
  "app/health",
  "app/integrations",
  "app/team",
  "app/usage",
  "app/billing",
  "app/settings",
  "app/settings/security",
  "app/settings/api-keys",
  "app/settings/audit-log",
] as const;

export const formRoutes = [
  "overview",
  "setup",
  "submissions",
  "schema",
  "protection",
  "notifications",
  "automations",
  "health",
  "analytics",
  "settings",
] as const;

export type FormRoute = (typeof formRoutes)[number];

const publicRoutes = new Set([
  "product",
  "features",
  "ai-builders",
  "form-builders",
  "guides",
  "form-health-monitoring",
  "schema-drift",
  "spam-protection",
  "file-uploads",
  "integrations",
  "agencies",
  "developers",
  "pricing",
  "security",
  "docs",
  "status",
  "contact",
  "privacy",
  "terms",
  "dpa",
]);

const aiBuilders = new Set(["lovable", "bolt", "v0", "cursor", "replit"]);
const formBuilders = new Set(["framer", "webflow"]);
const guides = new Set([
  "github-pages",
  "nextjs",
  "react",
  "static-html",
  "form-endpoint-api",
  "form-monitoring",
  "broken-form-monitoring",
]);

export function resolvePublicRoute(parts: readonly string[]): string | null {
  const key = parts.join("/");
  if (publicRoutes.has(key)) return key;
  if (parts.length === 2 && parts[0] === "ai-builders" && aiBuilders.has(parts[1] ?? ""))
    return key;
  if (parts.length === 2 && parts[0] === "form-builders" && formBuilders.has(parts[1] ?? ""))
    return key;
  if (parts.length === 2 && parts[0] === "guides" && guides.has(parts[1] ?? "")) return key;
  return null;
}

export function resolveAppRoute(
  parts: readonly string[],
):
  | { kind: "top"; route: (typeof appRoutes)[number] }
  | { kind: "form"; formId: string; route: FormRoute }
  | { kind: "submission"; submissionId: string }
  | null {
  const key = parts.join("/");
  if ((appRoutes as readonly string[]).includes(key))
    return { kind: "top", route: key as (typeof appRoutes)[number] };
  if (parts.length === 3 && parts[0] === "app" && parts[1] === "submissions" && parts[2])
    return { kind: "submission", submissionId: parts[2] };
  if (parts.length >= 3 && parts[0] === "app" && parts[1] === "forms" && parts[2]) {
    const route = parts.length === 3 ? "overview" : parts.length === 4 ? parts[3] : undefined;
    if (route && (formRoutes as readonly string[]).includes(route))
      return { kind: "form", formId: parts[2], route: route as FormRoute };
  }
  return null;
}
