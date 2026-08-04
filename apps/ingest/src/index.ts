import { createServer } from "node:http";
import { getRequestListener, type HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import {
  DevelopmentCaptchaVerifier,
  TurnstileVerifier,
  type CaptchaVerifier,
} from "@formsentinel/captcha";
import { readServerEnvironment, release } from "@formsentinel/config";
import { validateSubmission } from "@formsentinel/form-schema";
import {
  MemorySlidingWindowRateLimiter,
  trustedSourceAddress,
  type RateLimiter,
} from "@formsentinel/queue";
import { hashNetworkAddress } from "@formsentinel/security";
import { deterministicSpam } from "@formsentinel/spam";
import {
  generatedStorageKey,
  inspectFile,
  LocalPrivateStorage,
  type PrivateStorage,
} from "@formsentinel/storage";
import {
  createLocalDurableSubmissionStore,
  fingerprintPayload,
  MonthlySubmissionQuotaError,
  PostgresDurableSubmissionStore,
  type DurableSubmissionStore,
  type IngestForm,
  type SubmissionFileRecord,
} from "@formsentinel/submissions";

const supportedTypes = new Set([
  "application/json",
  "application/x-www-form-urlencoded",
  "multipart/form-data",
]);
const fieldName = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;
export interface IngestDependencies {
  store: DurableSubmissionStore;
  limiter: RateLimiter;
  storage: PrivateStorage;
  captcha?: CaptchaVerifier;
  environment: "development" | "test" | "production";
  sourceHashSecret: string;
  trustedProxyHops: number;
  globalBodyLimit: number;
  now?: () => Date;
}
const requestId = (value: string | undefined) =>
  value && /^[A-Za-z0-9_-]{8,100}$/.test(value) ? value : crypto.randomUUID();
class BodyLimitError extends Error {}
async function readBoundedBody(request: Request, maximum: number): Promise<Uint8Array> {
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new BodyLimitError("Request body is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}
function requestUsesHttps(requestUrl: URL, forwarded: string | undefined, trustedHops: number) {
  if (requestUrl.protocol === "https:") return true;
  if (trustedHops <= 0 || !forwarded) return false;
  const protocols = forwarded.split(",").map((value) => value.trim().toLowerCase());
  const selected = protocols.at(-trustedHops);
  return selected === "https";
}
function safeRedirect(
  value: string | null,
  environment: IngestDependencies["environment"],
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol === "https:" || (environment !== "production" && url.protocol === "http:"))
      return url.href;
  } catch {
    return null;
  }
  return null;
}
function publicError(
  id: string,
  code: string,
  message: string,
  status: number,
  fields?: Record<string, string>,
) {
  const body: {
    success: false;
    request_id: string;
    error: { code: string; message: string; fields?: Record<string, string> };
  } = { success: false, request_id: id, error: { code, message } };
  if (fields) body.error.fields = fields;
  return { body, status };
}
function originMatches(
  origin: string,
  policy: string,
  environment: IngestDependencies["environment"],
): boolean {
  if (origin === policy) return true;
  try {
    const actual = new URL(origin);
    const configured = new URL(policy.replace("*.", "wildcard."));
    if (policy.includes("*.")) {
      const suffix = configured.hostname.slice("wildcard".length);
      return (
        actual.protocol === configured.protocol &&
        actual.port === configured.port &&
        actual.hostname.endsWith(suffix) &&
        actual.hostname.length > suffix.length
      );
    }
    if (environment !== "production" && configured.hostname === "localhost")
      return actual.hostname === "localhost" && actual.protocol === configured.protocol;
  } catch {
    return false;
  }
  return false;
}
export function originPolicy(
  originHeader: string | null,
  form: IngestForm,
  environment: IngestDependencies["environment"],
): { allowed: boolean; origin: string | null } {
  if (!originHeader) return { allowed: form.allowNoOrigin, origin: null };
  try {
    const url = new URL(originHeader);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return { allowed: false, origin: null };
    const origin = url.origin;
    return {
      allowed:
        form.allowedOrigins.length === 0 ||
        form.allowedOrigins.some((item) => originMatches(origin, item, environment)),
      origin,
    };
  } catch {
    return { allowed: false, origin: null };
  }
}
function corsHeaders(policy: { allowed: boolean; origin: string | null }): Record<string, string> {
  const headers: Record<string, string> = { "cache-control": "no-store", vary: "Origin" };
  if (policy.allowed && policy.origin) headers["access-control-allow-origin"] = policy.origin;
  return headers;
}
interface ParsedBody {
  values: Record<string, unknown>;
  files: { field: string; file: File }[];
}
async function parseBody(
  bytes: Uint8Array,
  contentType: string,
  headers: Headers,
): Promise<ParsedBody> {
  if (contentType === "application/json") {
    const input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("invalid_object");
    for (const value of Object.values(input as Record<string, unknown>))
      if (value && typeof value === "object") throw new Error("nested_value");
    return { values: input as Record<string, unknown>, files: [] };
  }
  const parsed = await new Request("http://local/", {
    method: "POST",
    headers,
    body: bytes as Uint8Array<ArrayBuffer>,
  }).formData();
  const values: Record<string, unknown> = {};
  const files: { field: string; file: File }[] = [];
  for (const [name, value] of parsed.entries()) {
    if (typeof value !== "string") {
      files.push({ field: name, file: value });
      continue;
    }
    if (name in values) throw new Error("repeated_scalar");
    values[name] = value;
  }
  return { values, files };
}
function validatedFieldNames(
  values: Record<string, unknown>,
  files: readonly { field: string }[],
  maximum: number,
): string | null {
  const names = [...Object.keys(values), ...files.map((item) => item.field)];
  if (names.length > maximum) return "too_many_fields";
  if (names.some((name) => !fieldName.test(name) || name.includes("[") || name.includes(".")))
    return "invalid_field_name";
  return null;
}
async function rateLimit(limiter: RateLimiter, scopes: readonly [string, number, number][]) {
  for (const [key, limit, window] of scopes) {
    const result = await limiter.consume(key, limit, window);
    if (!result.allowed) return result;
  }
  return null;
}

export function createIngestApp(dependencies: IngestDependencies) {
  const app = new Hono<{ Bindings: HttpBindings }>();
  app.use("*", async (context, next) => {
    context.header("x-content-type-options", "nosniff");
    context.header("cache-control", "no-store");
    await next();
  });
  app.get("/health", (context) => context.json({ status: "ok", service: "ingest" }));
  app.get("/ready", async (context) => {
    try {
      await dependencies.store.resolveForm("__readiness__");
      return context.json({
        status: "ready",
        service: "ingest",
        store: dependencies.environment === "production" ? "postgres" : "local_durable",
      });
    } catch {
      return context.json({ status: "not_ready", service: "ingest" }, 503);
    }
  });
  app.get("/version", (context) => context.json(release()));
  const submissionPath = "/v1/forms/:publicFormId/submissions";
  app.options(submissionPath, async (context) => {
    const id = requestId(context.req.header("x-request-id"));
    context.header("x-request-id", id);
    const form = await dependencies.store.resolveForm(context.req.param("publicFormId"));
    if (!form)
      return context.json(publicError(id, "form_not_found", "Form not found.", 404).body, 404);
    const policy = originPolicy(
      context.req.header("origin") ?? null,
      form,
      dependencies.environment,
    );
    for (const [key, value] of Object.entries(corsHeaders(policy))) context.header(key, value);
    if (!policy.allowed)
      return context.json(
        publicError(id, "origin_not_allowed", "Origin is not allowed.", 403).body,
        403,
      );
    context.header("access-control-allow-methods", "POST, OPTIONS");
    context.header("access-control-allow-headers", "Content-Type, Idempotency-Key");
    context.header("access-control-max-age", "600");
    return context.body(null, 204);
  });
  app.post(submissionPath, async (context) => {
    const id = requestId(context.req.header("x-request-id"));
    context.header("x-request-id", id);
    const fail = (
      code: string,
      message: string,
      status: number,
      fields?: Record<string, string>,
    ) => {
      const result = publicError(id, code, message, status, fields);
      return context.json(result.body, result.status as 400);
    };
    let url: URL;
    try {
      url = new URL(context.req.url);
    } catch {
      return fail("invalid_request", "Invalid request URL.", 400);
    }
    if (
      dependencies.environment === "production" &&
      !requestUsesHttps(url, context.req.header("x-forwarded-proto"), dependencies.trustedProxyHops)
    )
      return fail("https_required", "HTTPS is required.", 400);
    const rawType = context.req.header("content-type") ?? "";
    const contentType = rawType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (!supportedTypes.has(contentType))
      return fail(
        "unsupported_content_type",
        "Use JSON, URL-encoded, or multipart form data.",
        415,
      );
    const idempotencyKey = context.req.header("idempotency-key") ?? null;
    if (idempotencyKey && (idempotencyKey.length > 200 || /[^\x21-\x7e]/.test(idempotencyKey)))
      return fail("invalid_idempotency_key", "Invalid idempotency key.", 400);
    for (const name of ["origin", "referer", "user-agent"] as const)
      if ((context.req.header(name)?.length ?? 0) > 2_048)
        return fail("header_too_large", "A request header is too large.", 431);
    const form = await dependencies.store.resolveForm(context.req.param("publicFormId"));
    if (!form) return fail("form_not_found", "Form not found.", 404);
    const incoming = context.env?.incoming;
    const direct = incoming?.socket.remoteAddress ?? "127.0.0.1";
    const source = trustedSourceAddress(
      direct,
      context.req.header("x-forwarded-for") ?? null,
      dependencies.trustedProxyHops,
    );
    const sourceHash = hashNetworkAddress(source, dependencies.sourceHashSecret);
    const limited = await rateLimit(dependencies.limiter, [
      [`source:${sourceHash}`, 60, 60_000],
      [`form:${form.id}`, 300, 60_000],
      [`workspace:${form.workspaceId}`, 1_000, 60_000],
    ]);
    if (limited) {
      context.header("retry-after", String(limited.retryAfterSeconds));
      return fail("rate_limited", "Too many requests. Try again later.", 429);
    }
    const policy = originPolicy(
      context.req.header("origin") ?? null,
      form,
      dependencies.environment,
    );
    for (const [key, value] of Object.entries(corsHeaders(policy))) context.header(key, value);
    if (!policy.allowed) return fail("origin_not_allowed", "Origin is not allowed.", 403);
    let bytes: Uint8Array;
    try {
      bytes = await readBoundedBody(context.req.raw, dependencies.globalBodyLimit);
    } catch (error) {
      if (error instanceof BodyLimitError)
        return fail("payload_too_large", "Request body is too large.", 413);
      return fail("invalid_body", "Unable to read request body.", 400);
    }
    if (bytes.byteLength > form.ingest.maxBodyBytes)
      return fail("payload_too_large", "Request body is too large.", 413);
    let parsed: ParsedBody;
    try {
      parsed = await parseBody(bytes, contentType, context.req.raw.headers);
    } catch {
      return fail("invalid_payload", "The submission payload is invalid.", 400);
    }
    const invalidName = validatedFieldNames(parsed.values, parsed.files, form.ingest.maxFields);
    if (invalidName) return fail(invalidName, "Submission fields are invalid.", 422);
    const captchaToken =
      typeof parsed.values["cf-turnstile-response"] === "string"
        ? parsed.values["cf-turnstile-response"]
        : typeof parsed.values["captcha_token"] === "string"
          ? parsed.values["captcha_token"]
          : null;
    delete parsed.values["cf-turnstile-response"];
    delete parsed.values["captcha_token"];
    const redirectRequested = parsed.values["_redirect"] === "true";
    delete parsed.values["_redirect"];
    let captchaValid: boolean | null = null;
    if (form.captcha) {
      const verifier =
        dependencies.captcha ??
        (form.captcha.provider === "turnstile"
          ? new TurnstileVerifier(form.captcha.secret)
          : new DevelopmentCaptchaVerifier(dependencies.environment));
      captchaValid = captchaToken ? (await verifier.verify(captchaToken, source)).success : false;
    }
    const honeypot = parsed.values[form.honeypotField];
    delete parsed.values[form.honeypotField];
    if (parsed.files.length > form.ingest.maxFiles)
      return fail("too_many_files", "Too many files.", 422);
    const validation = validateSubmission(form.fields, parsed.values);
    if (!validation.success)
      return fail("validation_failed", "One or more fields are invalid.", 422, validation.errors);
    const spam = deterministicSpam({
      payload: { ...validation.data, [form.honeypotField]: honeypot },
      honeypotField: form.honeypotField,
      captchaValid,
      userAgent: context.req.header("user-agent") ?? null,
    });
    const preparedFiles: {
      fieldName: string;
      filename: string;
      declaredType: string;
      detectedType: string;
      bytes: Uint8Array;
    }[] = [];
    let totalFileBytes = 0;
    for (const upload of parsed.files) {
      const fileBytes = new Uint8Array(await upload.file.arrayBuffer());
      totalFileBytes += fileBytes.byteLength;
      if (
        fileBytes.byteLength > form.ingest.maxFileBytes ||
        totalFileBytes > form.ingest.maxTotalFileBytes
      )
        return fail("file_too_large", "One or more files are too large.", 413);
      const inspection = inspectFile(upload.file.name, upload.file.type, fileBytes);
      if (!inspection.accepted || !inspection.detectedType)
        return fail("file_rejected", "One or more files were rejected.", 422);
      preparedFiles.push({
        fieldName: upload.field,
        filename: upload.file.name.slice(0, 255),
        declaredType: upload.file.type,
        detectedType: inspection.detectedType,
        bytes: fileBytes,
      });
    }
    const storedFiles: SubmissionFileRecord[] = [];
    try {
      for (const file of preparedFiles) {
        const key = generatedStorageKey(form.workspaceId, form.id);
        const stored = await dependencies.storage.putQuarantined(key, file.bytes);
        storedFiles.push({
          id: crypto.randomUUID(),
          fieldName: file.fieldName,
          originalFilename: file.filename,
          storageKey: stored.key,
          declaredType: file.declaredType,
          detectedType: file.detectedType,
          byteSize: stored.byteSize,
          checksumSha256: stored.checksumSha256,
          quarantineState: "quarantined",
          scanState: "pending",
        });
      }
    } catch {
      await Promise.allSettled(
        storedFiles.map((file) => dependencies.storage.delete(file.storageKey)),
      );
      return fail("storage_unavailable", "Unable to quarantine uploaded files.", 503);
    }
    const fingerprint = fingerprintPayload({
      payload: validation.data,
      files: storedFiles
        .map((file) => ({
          field: file.fieldName,
          checksum: file.checksumSha256,
          size: file.byteSize,
          type: file.detectedType,
        }))
        .sort((left, right) =>
          `${left.field}:${left.checksum}`.localeCompare(`${right.field}:${right.checksum}`),
        ),
    });
    let accepted: Awaited<ReturnType<DurableSubmissionStore["accept"]>>;
    try {
      accepted = await dependencies.store.accept({
        requestId: id,
        publicFormId: form.endpointKey,
        payload: validation.data,
        contentType,
        payloadBytes: bytes.byteLength,
        sourceIpHash: sourceHash,
        userAgent: (context.req.header("user-agent") ?? "").slice(0, 500) || null,
        origin: policy.origin,
        referrer: (context.req.header("referer") ?? "").slice(0, 2_048) || null,
        utm: Object.fromEntries(
          Object.entries(validation.data).filter(
            ([key, value]) => key.startsWith("utm_") && typeof value === "string",
          ),
        ) as Record<string, string>,
        spamStatus:
          spam.verdict === "allow" ? "allowed" : spam.verdict === "block" ? "blocked" : "review",
        spamScore: spam.score,
        spamReasons: [...spam.reasons],
        idempotencyKey,
        requestFingerprint: fingerprint,
        files: storedFiles,
        ...(dependencies.now ? { now: dependencies.now() } : {}),
      });
    } catch (error) {
      await Promise.allSettled(
        storedFiles.map((file) => dependencies.storage.delete(file.storageKey)),
      );
      if (error instanceof MonthlySubmissionQuotaError)
        return fail(
          "monthly_quota_reached",
          "The workspace monthly submission quota has been reached.",
          429,
        );
      return fail("service_unavailable", "Unable to accept the submission.", 503);
    }
    if (accepted.kind !== "accepted")
      await Promise.allSettled(
        storedFiles.map((file) => dependencies.storage.delete(file.storageKey)),
      );
    if (accepted.kind === "conflict")
      return fail(
        "idempotency_conflict",
        "The idempotency key was already used for a different request.",
        409,
      );
    const submission = accepted.submission;
    const response = {
      success: true as const,
      submission_id: submission.id,
      request_id: id,
      message:
        accepted.kind === "replayed" ? "Submission already accepted." : "Submission accepted.",
    };
    const redirect = safeRedirect(form.successRedirect, dependencies.environment);
    if (redirect && (context.req.header("accept")?.includes("text/html") || redirectRequested)) {
      context.header("location", redirect);
      return context.body(null, 303);
    }
    return context.json(response, accepted.kind === "replayed" ? 200 : 202);
  });
  app.all(submissionPath, (context) => {
    const id = requestId(context.req.header("x-request-id"));
    context.header("x-request-id", id);
    context.header("allow", "POST, OPTIONS");
    return context.json(
      publicError(id, "method_not_allowed", "Use POST or OPTIONS for this endpoint.", 405).body,
      405,
    );
  });
  app.onError((_error, context) => {
    const id = requestId(context.req.header("x-request-id"));
    context.header("x-request-id", id);
    return context.json(
      publicError(id, "internal_error", "The request could not be completed.", 500).body,
      500,
    );
  });
  app.notFound((context) => {
    const id = requestId(context.req.header("x-request-id"));
    context.header("x-request-id", id);
    return context.json(publicError(id, "not_found", "Not found.", 404).body, 404);
  });
  return app;
}

export function defaultIngestDependencies(): IngestDependencies {
  const configuration = readServerEnvironment();
  const environment = configuration.NODE_ENV;
  if (environment === "production")
    throw new Error(
      "Production ingest is unavailable until managed KMS, private object storage, and malware scanner adapters are configured.",
    );
  const adapter = configuration.FORMSENTINEL_DATA_ADAPTER;
  const store: DurableSubmissionStore =
    adapter === "postgres"
      ? new PostgresDurableSubmissionStore(configuration.DATABASE_URL!)
      : createLocalDurableSubmissionStore(configuration.FORMSENTINEL_LOCAL_DATA_FILE);
  return {
    store,
    limiter: new MemorySlidingWindowRateLimiter(environment),
    storage: new LocalPrivateStorage(configuration.FORMSENTINEL_LOCAL_STORAGE_DIR, environment),
    environment,
    sourceHashSecret: configuration.SOURCE_HASH_SECRET,
    trustedProxyHops: configuration.TRUSTED_PROXY_HOPS,
    globalBodyLimit: configuration.INGEST_MAX_BODY_BYTES,
  };
}
export function createIngestServer(dependencies = defaultIngestDependencies()) {
  const app = createIngestApp(dependencies);
  return createServer(getRequestListener(app.fetch));
}
if (process.env.NODE_ENV !== "test")
  createIngestServer().listen(Number(process.env.INGEST_PORT || process.env.PORT || 3001), () =>
    console.log("ingest listening"),
  );
