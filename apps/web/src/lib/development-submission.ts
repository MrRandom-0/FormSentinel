import { validateSubmission, type SubmissionField } from "@formsentinel/form-schema";

interface DevelopmentForm {
  name: string;
  allowedOrigins: readonly string[];
  honeypotField: string;
  notificationEmail: string | null;
  fields: readonly SubmissionField[];
}

interface CapturedSubmission {
  id: string;
  stages: readonly string[];
}

interface HandlerDependencies {
  environment: "development" | "test" | "production";
  getForm(publicFormId: string): Promise<DevelopmentForm | null>;
  capture(input: {
    kind: "submission";
    recipient: string;
    subject: string;
    body: string;
  }): Promise<CapturedSubmission>;
}

export type OriginPolicy =
  { allowed: true; origin: string | null } | { allowed: false; origin: string | null };

export function normalizeOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function requestOriginPolicy(
  requestOrigin: string | null,
  allowedOrigins: readonly string[],
): OriginPolicy {
  if (!requestOrigin) return { allowed: true, origin: null };
  const origin = normalizeOrigin(requestOrigin);
  if (!origin) return { allowed: false, origin: null };
  const allowed = allowedOrigins.length === 0 || allowedOrigins.includes(origin);
  return { allowed, origin };
}

function response(
  body: unknown,
  status: number,
  policy: OriginPolicy = { allowed: true, origin: null },
): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    vary: "Origin",
  });
  if (policy.allowed && policy.origin) headers.set("access-control-allow-origin", policy.origin);
  return new Response(JSON.stringify(body), { status, headers });
}

async function payload(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.includes("application/json")) return request.json();
  return Object.fromEntries(await request.formData());
}

export async function handleDevelopmentSubmission(
  request: Request,
  publicFormId: string,
  dependencies: HandlerDependencies,
): Promise<Response> {
  if (dependencies.environment === "production")
    return response({ error: "development_adapter_disabled" }, 404);

  const form = await dependencies.getForm(publicFormId);
  if (!form) return response({ error: "form_not_found" }, 404);

  const policy = requestOriginPolicy(request.headers.get("origin"), form.allowedOrigins);
  if (!policy.allowed) return response({ error: "origin_not_allowed" }, 403, policy);

  if (request.method === "OPTIONS") {
    const headers = new Headers({
      vary: "Origin",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "Content-Type",
      "access-control-max-age": "600",
    });
    if (policy.origin) headers.set("access-control-allow-origin", policy.origin);
    return new Response(null, { status: 204, headers });
  }

  let input: unknown;
  try {
    input = await payload(request);
  } catch {
    return response({ error: "invalid_payload" }, 400, policy);
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    return response({ error: "invalid_payload" }, 400, policy);

  const values = { ...(input as Record<string, unknown>) };
  const honeypot = values[form.honeypotField];
  delete values[form.honeypotField];
  if (honeypot) return response({ error: "spam_rejected", adapter: "development" }, 422, policy);

  const validation = validateSubmission(form.fields, values);
  if (!validation.success)
    return response({ error: "validation_failed", fields: validation.errors }, 422, policy);

  const captured = await dependencies.capture({
    kind: "submission",
    recipient: form.notificationEmail || "notification-not-configured",
    subject: `Development submission: ${form.name}`,
    body: JSON.stringify(validation.data),
  });
  return response(
    {
      accepted: true,
      adapter: "development",
      simulated: true,
      captureId: captured.id,
      stages: captured.stages,
    },
    202,
    policy,
  );
}
