import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DevelopmentCaptchaVerifier } from "@formsentinel/captcha";
import { MemorySlidingWindowRateLimiter, type RateLimiter } from "@formsentinel/queue";
import { LocalPrivateStorage } from "@formsentinel/storage";
import { LocalDurableSubmissionStore } from "@formsentinel/submissions";
import { createIngestApp, type IngestDependencies } from "./index";
const directories: string[] = [];
async function setup(
  overrides: Partial<IngestDependencies> = {},
  formOverrides: Record<string, unknown> = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "formsentinel-ingest-"));
  directories.push(directory);
  const file = join(directory, "data.json");
  await writeFile(
    file,
    JSON.stringify({
      forms: [
        {
          id: "form",
          workspaceId: "workspace",
          name: "Contact",
          endpointKey: "fs_test",
          active: true,
          fields: [
            { name: "email", type: "email", required: true },
            { name: "message", type: "textarea", required: false },
          ],
          allowedOrigins: ["https://site.example"],
          allowNoOrigin: true,
          honeypotField: "fax",
          notificationEmail: "team@example.test",
          maxBodyBytes: 10_000,
          ...formOverrides,
        },
      ],
    }),
  );
  const dependencies: IngestDependencies = {
    store: new LocalDurableSubmissionStore(file, "test"),
    limiter: new MemorySlidingWindowRateLimiter(),
    storage: new LocalPrivateStorage(join(directory, "files"), "test"),
    environment: "test",
    sourceHashSecret: "test-source-hash-secret",
    trustedProxyHops: 0,
    globalBodyLimit: 20_000,
    ...overrides,
  };
  return { app: createIngestApp(dependencies), store: dependencies.store };
}
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);
async function body(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}
describe("Hono ingest", () => {
  it.each(["/health", "/ready", "/version"])("serves %s", async (path) =>
    expect((await (await setup()).app.request(path)).status).toBe(200),
  );
  it.each([
    ["application/json", JSON.stringify({ email: "person@example.test", message: "Hello" })],
    ["application/x-www-form-urlencoded", "email=person%40example.test&message=Hello"],
  ])("accepts %s and durably queues", async (contentType, requestBody) => {
    const { app, store } = await setup();
    const response = await app.request("/v1/forms/fs_test/submissions", {
      method: "POST",
      headers: { "content-type": contentType },
      body: requestBody,
    });
    expect(response.status).toBe(202);
    const result = await body(response);
    expect(result).toMatchObject({ success: true });
    expect(await store.getSubmissionForWorker(String(result.submission_id))).not.toBeNull();
  });
  it("accepts multipart form data and leaves files quarantined for the worker", async () => {
    const { app, store } = await setup();
    const data = new FormData();
    data.set("email", "person@example.test");
    data.set(
      "attachment",
      new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "document.pdf", {
        type: "application/pdf",
      }),
    );
    const response = await app.request("/v1/forms/fs_test/submissions", {
      method: "POST",
      body: data,
    });
    expect(response.status).toBe(202);
    const result = await body(response);
    const submission = await store.getSubmissionForWorker(String(result.submission_id));
    expect(submission?.files[0]).toMatchObject({
      scanState: "pending",
      quarantineState: "quarantined",
      detectedType: "application/pdf",
    });
  });
  it("returns exact CORS headers and preflight contract", async () => {
    const { app } = await setup();
    const response = await app.request("/v1/forms/fs_test/submissions", {
      method: "OPTIONS",
      headers: { origin: "https://site.example" },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://site.example");
    expect(response.headers.get("access-control-allow-headers")).toContain("Idempotency-Key");
    expect(response.headers.get("vary")).toBe("Origin");
  });
  it("rejects disallowed origins without reflecting them", async () => {
    const { app } = await setup();
    const response = await app.request("/v1/forms/fs_test/submissions", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({ email: "person@example.test" }),
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });
  it("supports wildcard subdomains and development localhost origins", async () => {
    const wildcard = await setup({}, { allowedOrigins: ["https://*.example.test"] });
    const request = (origin: string) =>
      wildcard.app.request("/v1/forms/fs_test/submissions", {
        method: "POST",
        headers: { "content-type": "application/json", origin },
        body: JSON.stringify({ email: "person@example.test" }),
      });
    expect((await request("https://forms.example.test")).status).toBe(202);
    expect((await request("https://example.test")).status).toBe(403);
    const localhost = await setup({}, { allowedOrigins: ["http://localhost:3000"] });
    expect(
      (
        await localhost.app.request("/v1/forms/fs_test/submissions", {
          method: "POST",
          headers: { "content-type": "application/json", origin: "http://localhost:4173" },
          body: JSON.stringify({ email: "person@example.test" }),
        })
      ).status,
    ).toBe(202);
  });
  it("returns a structured 405 for unsupported methods", async () => {
    const { app } = await setup();
    const response = await app.request("/v1/forms/fs_test/submissions", { method: "PUT" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST, OPTIONS");
    expect(await body(response)).toMatchObject({ error: { code: "method_not_allowed" } });
  });
  it("trusts forwarded HTTPS only from configured proxy hops", async () => {
    const untrusted = await setup({ environment: "production" });
    const request = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-proto": "https",
      },
      body: JSON.stringify({ email: "person@example.test" }),
    };
    expect((await untrusted.app.request("/v1/forms/fs_test/submissions", request)).status).toBe(
      400,
    );
    const trusted = await setup({ environment: "production", trustedProxyHops: 1 });
    expect((await trusted.app.request("/v1/forms/fs_test/submissions", request)).status).toBe(202);
  });
  it("never follows an unsafe configured redirect", async () => {
    const { app } = await setup({}, { successRedirect: "javascript:alert(1)" });
    const response = await app.request("/v1/forms/fs_test/submissions", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/html" },
      body: JSON.stringify({ email: "person@example.test" }),
    });
    expect(response.status).toBe(202);
    expect(response.headers.get("location")).toBeNull();
  });
  it("enforces actual bytes independent of Content-Length", async () => {
    const { app } = await setup({}, { maxBodyBytes: 20 });
    const response = await app.request("/v1/forms/fs_test/submissions", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "1" },
      body: JSON.stringify({ email: "person@example.test" }),
    });
    expect(response.status).toBe(413);
  });
  it("returns structured validation and media errors", async () => {
    const { app } = await setup();
    const invalid = await app.request("/v1/forms/fs_test/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(invalid.status).toBe(422);
    expect(await body(invalid)).toMatchObject({
      success: false,
      error: { code: "validation_failed" },
    });
    expect(
      (
        await app.request("/v1/forms/fs_test/submissions", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: "hello",
        })
      ).status,
    ).toBe(415);
  });
  it("handles idempotent replay and key/fingerprint conflict", async () => {
    const { app } = await setup();
    const send = (email: string) =>
      app.request("/v1/forms/fs_test/submissions", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": "same-key" },
        body: JSON.stringify({ email }),
      });
    const first = await send("person@example.test");
    const firstBody = await body(first);
    const replay = await send("person@example.test");
    expect(replay.status).toBe(200);
    expect(await body(replay)).toMatchObject({ submission_id: firstBody.submission_id });
    expect((await send("other@example.test")).status).toBe(409);
  });
  it("enforces CAPTCHA without persisting its token", async () => {
    const { app, store } = await setup(
      { captcha: new DevelopmentCaptchaVerifier("test") },
      { captcha: { provider: "development", secret: "unused" } },
    );
    const denied = await app.request("/v1/forms/fs_test/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "person@example.test", captcha_token: "bad" }),
    });
    expect(denied.status).toBe(202);
    const deniedBody = await body(denied);
    const submission = await store.getSubmissionForWorker(String(deniedBody.submission_id));
    expect(submission?.spamReasons).toContain("invalid_captcha");
    expect(JSON.stringify(submission?.payload)).not.toContain("captcha");
  });
  it("returns 429 with request id and Retry-After", async () => {
    const denied: RateLimiter = {
      consume: async () => ({ allowed: false, remaining: 0, retryAfterSeconds: 12 }),
    };
    const { app } = await setup({ limiter: denied });
    const response = await app.request("/v1/forms/fs_test/submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "person@example.test" }),
    });
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("12");
    expect(response.headers.get("x-request-id")).toBeTruthy();
  });
});
