import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDevelopmentRepository } from "@formsentinel/database";
import { createIngestApp } from "@formsentinel/ingest";
import { MemorySlidingWindowRateLimiter } from "@formsentinel/queue";
import { DevelopmentEicarScanner, LocalPrivateStorage } from "@formsentinel/storage";
import { LocalDurableSubmissionStore } from "@formsentinel/submissions";
import { LocalCapturedWebhookTransport } from "@formsentinel/webhooks";
import { drainOnce } from "@formsentinel/worker";
const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);
describe("Phase 2 local durable flow", () => {
  it("creates tenant data, ingests, processes, and queries inbox/detail without credentials", async () => {
    const directory = await mkdtemp(join(tmpdir(), "formsentinel-e2e-"));
    directories.push(directory);
    const file = join(directory, "data.json");
    const files = join(directory, "files");
    const repository = new LocalDevelopmentRepository(file, "test");
    const registration = await repository.register({
      name: "User",
      email: "user@example.test",
      password: "correct horse battery staple",
    });
    await repository.verifyEmail(registration.verificationToken);
    const workspace = await repository.createWorkspace(registration.userId, "Workspace");
    const form = await repository.createForm(registration.userId, workspace.id, {
      name: "Contact",
      platform: "html",
      template: "contact",
      sourceUrl: null,
      successRedirect: null,
      allowedOrigins: ["https://site.example"],
      honeypotField: "fax",
      notificationEmail: "team@example.test",
      fields: [{ name: "email", type: "email", required: true }],
    });
    const store = new LocalDurableSubmissionStore(file, "test");
    const storage = new LocalPrivateStorage(files, "test");
    const app = createIngestApp({
      store,
      limiter: new MemorySlidingWindowRateLimiter(),
      storage,
      environment: "test",
      sourceHashSecret: "test-source-hash-secret",
      trustedProxyHops: 0,
      globalBodyLimit: 100_000,
    });
    const requests: RequestInit[] = [
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://site.example",
          "idempotency-key": "e2e-json",
        },
        body: JSON.stringify({ email: "json@example.test" }),
      },
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          origin: "https://site.example",
          "idempotency-key": "e2e-urlencoded",
        },
        body: "email=urlencoded%40example.test",
      },
      (() => {
        const body = new FormData();
        body.set("email", "multipart@example.test");
        return {
          method: "POST",
          headers: { origin: "https://site.example", "idempotency-key": "e2e-multipart" },
          body,
        };
      })(),
    ];
    const accepted: string[] = [];
    for (const request of requests) {
      const response = await app.request(`/v1/forms/${form.endpointKey}/submissions`, request);
      expect(response.status).toBe(202);
      accepted.push(String(((await response.json()) as { submission_id: string }).submission_id));
    }
    const worker = {
      store,
      storage,
      scanner: new DevelopmentEicarScanner("test"),
      webhookTransport: new LocalCapturedWebhookTransport(),
      environment: "test" as const,
      serviceToken: "test",
      owner: "e2e",
      concurrency: 2,
      leaseMs: 30_000,
      pollMs: 10,
    };
    expect(await drainOnce(worker)).toEqual({ claimed: 2, completed: 2, failed: 0 });
    expect(await drainOnce(worker)).toEqual({ claimed: 1, completed: 1, failed: 0 });
    const inbox = await store.listSubmissions(registration.userId, workspace.id);
    expect(new Set(inbox.items.map((item) => item.id))).toEqual(new Set(accepted));
    for (const submissionId of accepted) {
      const detail = await store.getSubmission(registration.userId, workspace.id, submissionId);
      expect(detail?.submission.processingState).toBe("processed");
      expect(detail?.deliveries[0]?.status).toBe("captured_local");
    }
  });
});
