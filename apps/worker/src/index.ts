import { createServer } from "node:http";
import { getRequestListener, type HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import { readServerEnvironment, release } from "@formsentinel/config";
import { autoresponderEmail, submissionEmail, validReplyTo } from "@formsentinel/email";
import { LocalPhase3Store, type Phase3EntityKind } from "@formsentinel/phase3-store";
import {
  assertIdsOnlyPayload,
  phase3Queues,
  retryDelay,
  type GeneralizedDurableQueue,
  type Phase3JobHandler,
  type Phase3QueueName,
} from "@formsentinel/queue";
import { constantTimeEqual } from "@formsentinel/security";
import {
  DevelopmentEicarScanner,
  LocalPrivateStorage,
  UnavailableMalwareScanner,
  UnavailablePrivateStorage,
  type MalwareScanner,
  type PrivateStorage,
} from "@formsentinel/storage";
import {
  createLocalDurableSubmissionStore,
  PostgresDurableSubmissionStore,
  type DeliveryEvent,
  type DurableSubmissionStore,
} from "@formsentinel/submissions";
import {
  LocalCapturedWebhookTransport,
  SafeWebhookTransport,
  signWebhook,
  type WebhookTransport,
} from "@formsentinel/webhooks";

export interface WorkerDependencies {
  store: DurableSubmissionStore;
  storage: PrivateStorage;
  scanner: MalwareScanner;
  webhookTransport: WebhookTransport;
  environment: "development" | "test" | "production";
  serviceToken: string;
  owner: string;
  concurrency: number;
  leaseMs: number;
  pollMs: number;
  now?: () => Date;
  phase3Queue?: GeneralizedDurableQueue;
  phase3Handlers?: Partial<Record<Phase3QueueName, Phase3JobHandler>>;
}
const deliveryInput = (
  input: Partial<DeliveryEvent> &
    Pick<
      DeliveryEvent,
      "eventKey" | "idempotencyKey" | "submissionId" | "destinationType" | "destination"
    >,
  now: Date,
): Omit<DeliveryEvent, "id" | "createdAt" | "updatedAt"> => ({
  eventKey: input.eventKey,
  idempotencyKey: input.idempotencyKey,
  submissionId: input.submissionId,
  destinationType: input.destinationType,
  destination: input.destination,
  status: input.status ?? "pending",
  attempts: input.attempts ?? 0,
  maxAttempts: input.maxAttempts ?? 5,
  nextAttemptAt: input.nextAttemptAt ?? now.toISOString(),
  terminal: input.terminal ?? false,
  lastError: input.lastError ?? null,
  responseCode: input.responseCode ?? null,
});
function isEmail(value: unknown): value is string {
  return (
    typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && !/[\r\n]/.test(value)
  );
}

export async function processSubmission(
  submissionId: string,
  dependencies: WorkerDependencies,
): Promise<void> {
  const now = dependencies.now?.() ?? new Date();
  const submission = await dependencies.store.getSubmissionForWorker(submissionId);
  if (!submission) throw new Error("Submission not found.");
  const form = await dependencies.store.resolveFormById(submission.formId);
  if (!form) throw new Error("Form not found.");
  await dependencies.store.updateProcessing(submission.id, "processing", now);
  await dependencies.store.addEvent(submission.id, "submission.processing", {}, now);
  for (const file of submission.files) {
    if (
      file.quarantineState === "released" ||
      file.quarantineState === "rejected" ||
      file.scanState === "infected"
    )
      continue;
    const bytes = await dependencies.storage.readAuthorized(file.storageKey);
    const result = await dependencies.scanner.scan(bytes);
    const quarantine =
      result.status === "clean"
        ? "released"
        : result.status === "infected"
          ? "rejected"
          : "quarantined";
    await dependencies.store.updateFileScan(submission.id, file.id, result.status, quarantine, now);
    await dependencies.store.addEvent(
      submission.id,
      `file.${result.status}`,
      { fileId: file.id },
      now,
    );
    if (result.status === "infected") await dependencies.storage.delete(file.storageKey);
  }
  if (form.notificationEmail && submission.spamStatus !== "blocked" && !submission.test) {
    const eventKey = `notification:${submission.id}:${form.notificationEmail}`;
    const delivery = await dependencies.store.upsertDelivery(
      deliveryInput(
        {
          eventKey,
          idempotencyKey: eventKey,
          submissionId: submission.id,
          destinationType: "notification",
          destination: form.notificationEmail,
        },
        now,
      ),
      now,
    );
    if (!delivery.terminal) {
      const replyTo = validReplyTo(submission.payload, form.fields);
      const message = submissionEmail({
        formName: form.name,
        fields: submission.payload,
        ...(replyTo ? { replyTo } : {}),
      });
      const local = dependencies.environment !== "production";
      await dependencies.store.updateDelivery(
        eventKey,
        {
          status: local ? "captured_local" : "unavailable",
          attempts: delivery.attempts + 1,
          terminal: true,
          lastError: local ? null : "No transactional email provider adapter is configured.",
        },
        now,
      );
      await dependencies.store.addEvent(
        submission.id,
        local ? "notification.captured_local" : "notification.unavailable",
        {
          destination: form.notificationEmail,
          subject: message.subject,
          text: message.text,
          html: message.html,
        },
        now,
      );
    }
  }
  const recipientField = form.autoresponderRecipientField;
  const recipient = recipientField ? submission.payload[recipientField] : null;
  if (
    recipientField &&
    isEmail(recipient) &&
    submission.spamStatus === "allowed" &&
    !submission.test &&
    recipient.toLowerCase() !==
      (process.env.EMAIL_FROM_ADDRESS || "noreply@example.test").toLowerCase()
  ) {
    const eventKey = `autoresponder:${submission.id}:${recipient}`;
    const delivery = await dependencies.store.upsertDelivery(
      deliveryInput(
        {
          eventKey,
          idempotencyKey: eventKey,
          submissionId: submission.id,
          destinationType: "autoresponder",
          destination: recipient,
        },
        now,
      ),
      now,
    );
    if (!delivery.terminal) {
      const message = autoresponderEmail({
        to: recipient,
        subject: form.autoresponderSubject || `Thanks for contacting ${form.name}`,
        body: form.autoresponderBody || "Thank you. Your submission has been received.",
      });
      const local = dependencies.environment !== "production";
      await dependencies.store.updateDelivery(
        eventKey,
        {
          status: local ? "captured_local" : "unavailable",
          attempts: delivery.attempts + 1,
          terminal: true,
          lastError: local ? null : "No transactional email provider adapter is configured.",
        },
        now,
      );
      await dependencies.store.addEvent(
        submission.id,
        local ? "autoresponder.captured_local" : "autoresponder.unavailable",
        {
          destination: recipient,
          subject: message.subject,
          text: message.text,
          html: message.html,
        },
        now,
      );
    }
  }
  const webhooks = submission.test
    ? []
    : await dependencies.store.listWebhooks(
        submission.workspaceId,
        submission.formId,
        "submission.accepted",
      );
  const failures: string[] = [];
  for (const endpoint of webhooks) {
    const eventKey = `webhook:${submission.id}:${endpoint.id}:submission.accepted`;
    const delivery = await dependencies.store.upsertDelivery(
      deliveryInput(
        {
          eventKey,
          idempotencyKey: eventKey,
          submissionId: submission.id,
          destinationType: "webhook",
          destination: endpoint.url,
        },
        now,
      ),
      now,
    );
    if (delivery.terminal) continue;
    const envelope = {
      id: delivery.id,
      type: "submission.accepted",
      createdAt: submission.createdAt,
      version: "2025-01-01" as const,
      data: {
        submission: {
          id: submission.id,
          form_id: submission.formId,
          created_at: submission.createdAt,
          fields: submission.payload,
        },
      },
    };
    const body = JSON.stringify(envelope);
    const timestamp = Math.floor(now.getTime() / 1000);
    const attempts = delivery.attempts + 1;
    try {
      const response = await dependencies.webhookTransport.deliver(endpoint.url, body, {
        "x-formsentinel-signature": signWebhook(body, endpoint.secret, timestamp),
        "x-formsentinel-timestamp": String(timestamp),
        "x-formsentinel-event": "submission.accepted",
        "x-formsentinel-idempotency-key": eventKey,
      });
      const successful = response.status >= 200 && response.status < 300;
      const status =
        response.state === "captured_local"
          ? "captured_local"
          : successful
            ? "delivered"
            : attempts >= delivery.maxAttempts
              ? "dead_letter"
              : "failed";
      await dependencies.store.updateDelivery(
        eventKey,
        {
          status,
          attempts,
          terminal:
            status === "captured_local" || status === "delivered" || status === "dead_letter",
          nextAttemptAt: new Date(now.getTime() + retryDelay(attempts)).toISOString(),
          responseCode: response.status,
          lastError: successful ? null : `HTTP ${response.status}`,
        },
        now,
      );
      await dependencies.store.addEvent(
        submission.id,
        `webhook.${status}`,
        { endpointId: endpoint.id, eventId: delivery.id, responseCode: response.status },
        now,
      );
      await dependencies.store.recordWebhookResult(endpoint.id, successful, 10, now);
      if (!successful) failures.push(`Webhook ${endpoint.id} returned ${response.status}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Webhook delivery failed";
      await dependencies.store.updateDelivery(
        eventKey,
        {
          status: attempts >= delivery.maxAttempts ? "dead_letter" : "failed",
          attempts,
          terminal: attempts >= delivery.maxAttempts,
          nextAttemptAt: new Date(now.getTime() + retryDelay(attempts)).toISOString(),
          lastError: message,
        },
        now,
      );
      await dependencies.store.recordWebhookResult(endpoint.id, false, 10, now);
      failures.push(message);
    }
  }
  if (failures.length) {
    await dependencies.store.updateProcessing(submission.id, "failed", now);
    throw new Error(failures.join("; "));
  }
  await dependencies.store.updateProcessing(submission.id, "processed", now);
  await dependencies.store.addEvent(submission.id, "submission.processed", {}, now);
}

export async function drainOnce(
  dependencies: WorkerDependencies,
): Promise<{ claimed: number; completed: number; failed: number }> {
  const jobs = await dependencies.store.claim(
    dependencies.owner,
    dependencies.concurrency,
    dependencies.leaseMs,
    dependencies.now?.(),
  );
  let completed = 0;
  let failed = 0;
  await Promise.all(
    jobs.map(async (job) => {
      const submissionId =
        job.type === "submission.process" &&
        typeof job.payload === "object" &&
        typeof (job.payload as Record<string, unknown>).submissionId === "string"
          ? ((job.payload as Record<string, unknown>).submissionId as string)
          : null;
      try {
        if (!submissionId) throw new Error("Invalid job payload.");
        await processSubmission(submissionId, dependencies);
        if (await dependencies.store.complete(job.id, dependencies.owner, dependencies.now?.()))
          completed += 1;
        else {
          failed += 1;
          await dependencies.store.addEvent(
            submissionId,
            "job.lost_lease",
            { jobId: job.id, attempt: job.attempts },
            dependencies.now?.(),
          );
        }
      } catch (error) {
        failed += 1;
        const message = error instanceof Error ? error.message : "Worker failure";
        const outcome = await dependencies.store.fail(
          job.id,
          dependencies.owner,
          message,
          dependencies.now?.(),
        );
        if (submissionId) {
          await dependencies.store.updateProcessing(submissionId, "failed", dependencies.now?.());
          await dependencies.store.addEvent(
            submissionId,
            `job.${outcome}`,
            { jobId: job.id, attempt: job.attempts, error: message.slice(0, 500) },
            dependencies.now?.(),
          );
        }
      }
    }),
  );
  return { claimed: jobs.length, completed, failed };
}
export async function drainPhase3Once(
  dependencies: WorkerDependencies,
): Promise<{ claimed: number; completed: number; failed: number }> {
  if (!dependencies.phase3Queue) return { claimed: 0, completed: 0, failed: 0 };
  let claimed = 0;
  let completed = 0;
  let failed = 0;
  for (const queue of phase3Queues) {
    const handler = dependencies.phase3Handlers?.[queue];
    if (!handler) continue;
    const jobs = await dependencies.phase3Queue.claimQueue(
      queue,
      dependencies.owner,
      dependencies.concurrency,
      dependencies.leaseMs,
      dependencies.now?.(),
    );
    claimed += jobs.length;
    await Promise.all(
      jobs.map(async (job) => {
        try {
          assertIdsOnlyPayload(job.payload);
          await handler(job.payload, job);
          if (
            await dependencies.phase3Queue!.complete(
              job.id,
              dependencies.owner,
              dependencies.now?.(),
            )
          )
            completed += 1;
          else failed += 1;
        } catch (error) {
          failed += 1;
          await dependencies.phase3Queue!.fail(
            job.id,
            dependencies.owner,
            error instanceof Error ? error.message : "Phase 3 worker failure",
            dependencies.now?.(),
          );
        }
      }),
    );
  }
  return { claimed, completed, failed };
}
export function createWorkerApp(dependencies: WorkerDependencies) {
  const app = new Hono<{ Bindings: HttpBindings }>();
  app.get("/health", (context) => context.json({ status: "ok", service: "worker" }));
  app.get("/ready", (context) =>
    context.json({
      status: "ready",
      service: "worker",
      queue: "durable_leased",
      phase3: dependencies.phase3Queue ? "local_preview" : "unavailable",
    }),
  );
  app.get("/version", (context) => context.json(release()));
  app.post("/v1/jobs/process", async (context) => {
    const provided =
      (context.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "") ||
      context.req.header("x-service-token") ||
      "";
    if (!dependencies.serviceToken || !constantTimeEqual(provided, dependencies.serviceToken))
      return context.json({ error: "unauthorized" }, 401);
    return context.json(await drainOnce(dependencies));
  });
  return app;
}
const phase3HandlerTargets: Record<Phase3QueueName, { kind: Phase3EntityKind; idKey: string }> = {
  scan: { kind: "scanner_run", idKey: "scanRunId" },
  health: { kind: "monitor_run", idKey: "monitorRunId" },
  alerts: { kind: "alert_delivery", idKey: "alertDeliveryId" },
  reliability: { kind: "reliability_snapshot", idKey: "reliabilitySnapshotId" },
  integration_delivery: { kind: "integration_delivery", idKey: "integrationDeliveryId" },
  analytics_aggregation: { kind: "analytics_aggregate", idKey: "analyticsAggregateId" },
  reports: { kind: "report_request", idKey: "reportRequestId" },
};
export function createLocalPhase3Handlers(
  store: LocalPhase3Store,
): Record<Phase3QueueName, Phase3JobHandler> {
  return Object.fromEntries(
    phase3Queues.map((queue) => [
      queue,
      async (payload: Readonly<Record<string, string>>) => {
        const workspaceId = payload.workspaceId;
        const target = phase3HandlerTargets[queue];
        const targetId = payload[target.idKey];
        if (!workspaceId || !targetId) throw new Error("phase3_handler_ids_required");
        const record = await store.get<Record<string, unknown>>(workspaceId, target.kind, targetId);
        if (!record) throw new Error("phase3_handler_target_not_found");
        await store.update(workspaceId, target.kind, targetId, record.version, {
          ...record.data,
          workerStatus: "completed",
          handledQueue: queue,
        });
        await store.create({
          kind: "audit_event",
          workspaceId,
          immutable: true,
          data: { action: `worker.${queue}.handled`, targetId },
        });
      },
    ]),
  ) as unknown as Record<Phase3QueueName, Phase3JobHandler>;
}
export function defaultWorkerDependencies(): WorkerDependencies {
  const configuration = readServerEnvironment();
  const environment = configuration.NODE_ENV;
  const adapter = configuration.FORMSENTINEL_DATA_ADAPTER;
  const store: DurableSubmissionStore =
    adapter === "postgres"
      ? new PostgresDurableSubmissionStore(configuration.DATABASE_URL!)
      : createLocalDurableSubmissionStore(configuration.FORMSENTINEL_LOCAL_DATA_FILE);
  const phase3Store =
    environment === "production"
      ? undefined
      : new LocalPhase3Store(configuration.FORMSENTINEL_LOCAL_DATA_FILE, environment);
  const phase3Handlers = phase3Store ? createLocalPhase3Handlers(phase3Store) : undefined;
  return {
    store,
    storage:
      environment === "production"
        ? new UnavailablePrivateStorage()
        : new LocalPrivateStorage(configuration.FORMSENTINEL_LOCAL_STORAGE_DIR, environment),
    scanner:
      environment === "production"
        ? new UnavailableMalwareScanner()
        : new DevelopmentEicarScanner(environment),
    webhookTransport:
      environment === "production"
        ? new SafeWebhookTransport()
        : new LocalCapturedWebhookTransport(),
    environment,
    serviceToken: configuration.SERVICE_TOKEN,
    owner: `${process.pid}-${crypto.randomUUID()}`,
    concurrency: configuration.WORKER_CONCURRENCY,
    leaseMs: configuration.WORKER_LEASE_MS,
    pollMs: configuration.WORKER_POLL_MS,
    ...(phase3Store ? { phase3Queue: phase3Store, phase3Handlers: phase3Handlers! } : {}),
  };
}
export function createWorkerServer(dependencies = defaultWorkerDependencies()) {
  const app = createWorkerApp(dependencies);
  return createServer(getRequestListener(app.fetch));
}
export async function runWorker(
  dependencies = defaultWorkerDependencies(),
  signal?: AbortSignal,
): Promise<void> {
  while (!signal?.aborted) {
    try {
      await drainOnce(dependencies);
      await drainPhase3Once(dependencies);
    } catch (error) {
      console.error("worker poll failed", error instanceof Error ? error.message : "unknown error");
    }
    await new Promise((resolveDelay) => {
      const timer = setTimeout(resolveDelay, dependencies.pollMs);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolveDelay(undefined);
        },
        { once: true },
      );
    });
  }
}
if (process.env.NODE_ENV !== "test") {
  const dependencies = defaultWorkerDependencies();
  const controller = new AbortController();
  process.once("SIGTERM", () => controller.abort());
  process.once("SIGINT", () => controller.abort());
  createWorkerServer(dependencies).listen(
    Number(process.env.WORKER_PORT || process.env.PORT || 3002),
    () => console.log("worker listening"),
  );
  void runWorker(dependencies, controller.signal);
}
