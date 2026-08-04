import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalPhase3Store } from "@formsentinel/phase3-store";
import {
  DevelopmentEicarScanner,
  LocalPrivateStorage,
  UnavailableMalwareScanner,
} from "@formsentinel/storage";
import {
  fingerprintPayload,
  LocalDurableSubmissionStore,
  SYSTEM_ACTOR_ID,
} from "@formsentinel/submissions";
import { LocalCapturedWebhookTransport, type WebhookTransport } from "@formsentinel/webhooks";
import {
  createLocalPhase3Handlers,
  createWorkerApp,
  drainOnce,
  drainPhase3Once,
  type WorkerDependencies,
} from "./index";
const directories: string[] = [];
async function setup(
  environment: "test" | "production" = "test",
  transport: WebhookTransport = new LocalCapturedWebhookTransport(),
  withInfectedFile = false,
  synthetic = false,
) {
  const directory = await mkdtemp(join(tmpdir(), "formsentinel-worker-"));
  directories.push(directory);
  const file = join(directory, "data.json");
  await writeFile(
    file,
    JSON.stringify({
      memberships: [{ userId: "user", workspaceId: "workspace" }],
      forms: [
        {
          id: "form",
          workspaceId: "workspace",
          name: "Contact",
          endpointKey: "fs_test",
          active: true,
          fields: [{ name: "email", type: "email", required: true }],
          allowedOrigins: [],
          notificationEmail: "team@example.test",
          autoresponderRecipientField: "email",
          autoresponderSubject: "Thanks for writing",
          autoresponderBody: "We received <your message>.",
        },
      ],
      phase2: {
        submissions: [],
        events: [],
        jobs: [],
        deliveries: [],
        webhooks: [
          {
            id: "hook",
            workspaceId: "workspace",
            formId: "form",
            url: "https://hooks.example.test",
            secret: "secret",
            previousSecret: null,
            previousSecretExpiresAt: null,
            subscribedEvents: ["submission.accepted"],
            status: "active",
            consecutiveFailures: 0,
          },
        ],
      },
    }),
  );
  const store = new LocalDurableSubmissionStore(file, "test");
  const storage = new LocalPrivateStorage(join(directory, "files"), "test");
  const eicar = new TextEncoder().encode(
    "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
  );
  const storedFile = withInfectedFile
    ? await storage.putQuarantined("quarantine/workspace/form/infected", eicar)
    : null;
  const accepted = await store.accept({
    requestId: "request",
    publicFormId: "fs_test",
    payload: { email: "person@example.test" },
    contentType: "application/json",
    payloadBytes: 10,
    sourceIpHash: "hash",
    userAgent: null,
    origin: null,
    referrer: null,
    utm: {},
    spamStatus: "allowed",
    spamScore: 0,
    spamReasons: [],
    test: synthetic,
    idempotencyKey: null,
    requestFingerprint: fingerprintPayload({ email: "person@example.test" }),
    ...(storedFile
      ? {
          files: [
            {
              id: "infected-file",
              fieldName: "attachment",
              originalFilename: "eicar.txt",
              storageKey: storedFile.key,
              declaredType: "text/plain",
              detectedType: "text/plain",
              byteSize: storedFile.byteSize,
              checksumSha256: storedFile.checksumSha256,
              quarantineState: "quarantined" as const,
              scanState: "pending" as const,
            },
          ],
        }
      : {}),
  });
  if (accepted.kind === "conflict") throw new Error("Unexpected conflict");
  let current = new Date();
  const dependencies: WorkerDependencies = {
    store,
    storage,
    scanner:
      environment === "production"
        ? new UnavailableMalwareScanner()
        : new DevelopmentEicarScanner("test"),
    webhookTransport: transport,
    environment,
    serviceToken: "test-service-token",
    owner: "worker",
    concurrency: 2,
    leaseMs: 1000,
    pollMs: 10,
    now: () => current,
  };
  return {
    store,
    dependencies,
    submissionId: accepted.submission.id,
    advance: () => {
      current = new Date(current.getTime() + 86_400_000);
    },
  };
}
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);
describe("durable worker", () => {
  it("serves operations and protects manual drain", async () => {
    const { dependencies } = await setup();
    const app = createWorkerApp(dependencies);
    expect((await app.request("/health")).status).toBe(200);
    expect((await app.request("/v1/jobs/process", { method: "POST" })).status).toBe(401);
    expect(
      (
        await app.request("/v1/jobs/process", {
          method: "POST",
          headers: { authorization: "Bearer test-service-token" },
        })
      ).status,
    ).toBe(200);
  });
  it("processes accepted submissions into durable local captures", async () => {
    const { store, dependencies, submissionId } = await setup();
    expect(await drainOnce(dependencies)).toEqual({ claimed: 1, completed: 1, failed: 0 });
    const detail = await store.getSubmission(SYSTEM_ACTOR_ID, "workspace", submissionId);
    expect(detail?.submission.processingState).toBe("processed");
    expect(detail?.deliveries.map((item) => item.status)).toEqual([
      "captured_local",
      "captured_local",
      "captured_local",
    ]);
    expect(detail?.events.map((item) => item.type)).toContain("submission.processed");
    expect(
      detail?.events.find((item) => item.type === "autoresponder.captured_local")?.metadata.html,
    ).toContain("&lt;your message&gt;");
  });
  it("suppresses all normal external side effects for synthetic submissions", async () => {
    const { store, dependencies, submissionId } = await setup(
      "test",
      new LocalCapturedWebhookTransport(),
      false,
      true,
    );
    expect(await drainOnce(dependencies)).toEqual({ claimed: 1, completed: 1, failed: 0 });
    const detail = await store.getSubmission(SYSTEM_ACTOR_ID, "workspace", submissionId);
    expect(detail?.deliveries).toEqual([]);
    expect(detail?.events.map((event) => event.type)).not.toEqual(
      expect.arrayContaining([
        "notification.captured_local",
        "autoresponder.captured_local",
        "webhook.captured_local",
      ]),
    );
  });
  it("reports external email unavailable without pretending delivery", async () => {
    const { store, dependencies, submissionId } = await setup(
      "production",
      new LocalCapturedWebhookTransport(),
    );
    await drainOnce(dependencies);
    const detail = await store.getSubmission(SYSTEM_ACTOR_ID, "workspace", submissionId);
    expect(detail?.deliveries.find((item) => item.destinationType === "notification")?.status).toBe(
      "unavailable",
    );
  });
  it("retries failed webhooks without replaying completed notification", async () => {
    let calls = 0;
    const transport: WebhookTransport = {
      deliver: async () => {
        calls += 1;
        if (calls === 1) throw new Error("temporary");
        return { status: 204, state: "delivered" };
      },
    };
    const { store, dependencies, submissionId, advance } = await setup("test", transport, true);
    expect((await drainOnce(dependencies)).failed).toBe(1);
    advance();
    expect((await drainOnce(dependencies)).completed).toBe(1);
    const detail = await store.getSubmission(SYSTEM_ACTOR_ID, "workspace", submissionId);
    expect(
      detail?.deliveries.find((item) => item.destinationType === "notification")?.attempts,
    ).toBe(1);
    expect(detail?.deliveries.find((item) => item.destinationType === "webhook")?.attempts).toBe(2);
    expect(detail?.submission.files[0]).toMatchObject({
      scanState: "infected",
      quarantineState: "rejected",
    });
  });
  it("dispatches default Phase 3 handlers to persisted targets", async () => {
    const { dependencies } = await setup();
    const directory = await mkdtemp(join(tmpdir(), "formsentinel-phase3-worker-"));
    directories.push(directory);
    const store = new LocalPhase3Store(join(directory, "phase3.json"), "test");
    const run = await store.create({
      kind: "scanner_run",
      workspaceId: "workspace",
      data: { status: "pending" },
    });
    await store.enqueue(
      "scan",
      "scan.run",
      { workspaceId: "workspace", scanRunId: run.id },
      `scan:${run.id}`,
      new Date(0),
    );
    expect(
      await drainPhase3Once({
        ...dependencies,
        phase3Queue: store,
        phase3Handlers: createLocalPhase3Handlers(store),
      }),
    ).toEqual({ claimed: 1, completed: 1, failed: 0 });
    expect(await store.get("workspace", "scanner_run", run.id)).toMatchObject({
      data: { workerStatus: "completed", handledQueue: "scan" },
    });
    expect(await store.list("workspace", "audit_event")).toHaveLength(1);
  });
  it("dead letters jobs after bounded attempts", async () => {
    const transport: WebhookTransport = {
      deliver: async () => {
        throw new Error("always fails");
      },
    };
    const { dependencies, advance } = await setup("test", transport);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await drainOnce(dependencies);
      advance();
    }
    expect((await drainOnce(dependencies)).claimed).toBe(0);
  });
});
