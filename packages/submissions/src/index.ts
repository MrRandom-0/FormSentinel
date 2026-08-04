import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { retryDelay, type DurableQueue, type LeasedJob } from "@formsentinel/queue";
import { requirePermission, type Permission, type WorkspaceRole } from "@formsentinel/auth";

/**
 * A reserved user ID that represents the internal system/service actor.
 * When passed as the userId to authorized store methods, permission checks
 * are bypassed. This allows the worker and other service-level callers to
 * access submissions without requiring an end-user workspace role.
 */
export const SYSTEM_ACTOR_ID = "__system__";

export type SubmissionStatus = "new" | "viewed" | "resolved" | "spam" | "deleted";
export type ProcessingState = "pending" | "processing" | "processed" | "failed";
export type DeliveryState =
  "pending" | "captured_local" | "delivered" | "unavailable" | "failed" | "dead_letter";

export interface IngestForm {
  id: string;
  workspaceId: string;
  name: string;
  endpointKey: string;
  active: boolean;
  fields: readonly {
    name: string;
    type: "text" | "email" | "textarea" | "tel" | "url" | "number" | "checkbox";
    required: boolean;
  }[];
  allowedOrigins: readonly string[];
  allowNoOrigin: boolean;
  successRedirect: string | null;
  honeypotField: string;
  notificationEmail: string | null;
  autoresponderRecipientField: string | null;
  autoresponderSubject: string | null;
  autoresponderBody: string | null;
  captcha: null | { provider: "turnstile" | "development"; secret: string };
  schemaVersion: number;
  ingest: {
    maxBodyBytes: number;
    maxFields: number;
    maxFiles: number;
    maxFileBytes: number;
    maxTotalFileBytes: number;
    idempotencyWindowMs: number;
    duplicateWindowMs: number;
  };
}

export interface SubmissionFileRecord {
  id: string;
  fieldName: string;
  originalFilename: string;
  storageKey: string;
  declaredType: string;
  detectedType: string;
  byteSize: number;
  checksumSha256: string;
  quarantineState: "quarantined" | "released" | "rejected";
  scanState: "pending" | "clean" | "infected" | "unavailable";
}
export interface SubmissionRecord {
  id: string;
  requestId: string;
  formId: string;
  workspaceId: string;
  payload: Record<string, string | number | boolean | string[]>;
  contentType: string;
  payloadBytes: number;
  schemaVersion: number;
  sourceIpHash: string;
  userAgent: string | null;
  origin: string | null;
  referrer: string | null;
  utm: Record<string, string>;
  status: SubmissionStatus;
  previousStatus: SubmissionStatus | null;
  spamStatus: "allowed" | "review" | "blocked";
  spamScore: number;
  spamReasons: string[];
  test: boolean;
  processingState: ProcessingState;
  notificationState: DeliveryState;
  webhookState: DeliveryState;
  idempotencyKey: string | null;
  requestFingerprint: string;
  probableDuplicate: boolean;
  duplicateOfId: string | null;
  retentionUntil: string | null;
  tags: string[];
  files: SubmissionFileRecord[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}
export interface SubmissionEvent {
  id: string;
  submissionId: string;
  type: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}
export interface BackgroundJob {
  id: string;
  queue: string;
  type: string;
  payload: Record<string, unknown>;
  dedupeKey: string;
  status: "pending" | "leased" | "retry" | "completed" | "dead_letter";
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  completedAt: string | null;
  deadLetteredAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface DeliveryEvent {
  id: string;
  eventKey: string;
  idempotencyKey: string;
  submissionId: string;
  destinationType: "notification" | "autoresponder" | "webhook";
  destination: string;
  status: DeliveryState;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  terminal: boolean;
  lastError: string | null;
  responseCode: number | null;
  createdAt: string;
  updatedAt: string;
}
export interface WebhookEndpointRecord {
  id: string;
  workspaceId: string;
  formId: string | null;
  url: string;
  secret: string;
  previousSecret: string | null;
  previousSecretExpiresAt: string | null;
  subscribedEvents: string[];
  status: "active" | "disabled";
  consecutiveFailures: number;
}

interface RootState {
  users?: { id: string }[];
  workspaces?: { id: string }[];
  memberships?: { userId: string; workspaceId: string; role?: WorkspaceRole }[];
  forms?: Record<string, unknown>[];
  phase2?: Phase2State;
}
interface Phase2State {
  submissions: SubmissionRecord[];
  events: SubmissionEvent[];
  jobs: BackgroundJob[];
  deliveries: DeliveryEvent[];
  webhooks: WebhookEndpointRecord[];
}
const emptyPhase2 = (): Phase2State => ({
  submissions: [],
  events: [],
  jobs: [],
  deliveries: [],
  webhooks: [],
});
const iso = (date = new Date()) => date.toISOString();
const defaults: IngestForm["ingest"] = {
  maxBodyBytes: 1_048_576,
  maxFields: 50,
  maxFiles: 5,
  maxFileBytes: 5_242_880,
  maxTotalFileBytes: 10_485_760,
  idempotencyWindowMs: 86_400_000,
  duplicateWindowMs: 3_600_000,
};

export interface AcceptSubmissionInput {
  requestId: string;
  publicFormId: string;
  payload: Record<string, string | number | boolean | string[]>;
  contentType: string;
  payloadBytes: number;
  sourceIpHash: string;
  userAgent: string | null;
  origin: string | null;
  referrer: string | null;
  utm: Record<string, string>;
  spamStatus: SubmissionRecord["spamStatus"];
  spamScore: number;
  spamReasons: string[];
  test?: boolean;
  idempotencyKey: string | null;
  requestFingerprint: string;
  files?: SubmissionFileRecord[];
  now?: Date;
}
export type AcceptSubmissionResult =
  | { kind: "accepted"; submission: SubmissionRecord }
  | { kind: "replayed"; submission: SubmissionRecord }
  | { kind: "conflict" };
export interface SubmissionFilter {
  formId?: string;
  status?: SubmissionStatus;
  spamStatus?: SubmissionRecord["spamStatus"];
  search?: string;
  from?: Date;
  to?: Date;
  cursor?: string;
  limit?: number;
}
export interface SubmissionPage {
  items: SubmissionRecord[];
  nextCursor: string | null;
}
export interface SubmissionCursor {
  createdAt: string;
  id: string;
}
export function encodeSubmissionCursor(value: SubmissionCursor): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}
export function decodeSubmissionCursor(value?: string): SubmissionCursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as SubmissionCursor;
    if (!parsed.id || !Number.isFinite(Date.parse(parsed.createdAt))) return null;
    return parsed;
  } catch {
    // Keep legacy timestamp cursors readable while all newly emitted cursors are composite.
    return Number.isFinite(Date.parse(value))
      ? { createdAt: value, id: "ffffffff-ffff-ffff-ffff-ffffffffffff" }
      : null;
  }
}

export interface DurableSubmissionStore extends DurableQueue {
  resolveForm(publicFormId: string): Promise<IngestForm | null>;
  resolveFormById(formId: string): Promise<IngestForm | null>;
  accept(input: AcceptSubmissionInput): Promise<AcceptSubmissionResult>;
  addEvent(
    submissionId: string,
    type: string,
    metadata?: Record<string, unknown>,
    now?: Date,
  ): Promise<void>;
  getSubmissionForWorker(id: string): Promise<SubmissionRecord | null>;
  updateProcessing(id: string, state: ProcessingState, now?: Date): Promise<void>;
  updateFileScan(
    submissionId: string,
    fileId: string,
    scanState: SubmissionFileRecord["scanState"],
    quarantineState: SubmissionFileRecord["quarantineState"],
    now?: Date,
  ): Promise<void>;
  upsertDelivery(
    input: Omit<DeliveryEvent, "id" | "createdAt" | "updatedAt">,
    now?: Date,
  ): Promise<DeliveryEvent>;
  updateDelivery(
    eventKey: string,
    update: Partial<
      Pick<
        DeliveryEvent,
        "status" | "attempts" | "nextAttemptAt" | "terminal" | "lastError" | "responseCode"
      >
    >,
    now?: Date,
  ): Promise<void>;
  listWebhooks(
    workspaceId: string,
    formId: string,
    event: string,
  ): Promise<readonly WebhookEndpointRecord[]>;
  recordWebhookResult(
    endpointId: string,
    success: boolean,
    disableThreshold?: number,
    now?: Date,
  ): Promise<void>;
  listSubmissions(
    userId: string,
    workspaceId: string,
    filter?: SubmissionFilter,
  ): Promise<SubmissionPage>;
  getSubmission(
    userId: string,
    workspaceId: string,
    id: string,
  ): Promise<{
    submission: SubmissionRecord;
    events: SubmissionEvent[];
    deliveries: DeliveryEvent[];
  } | null>;
  updateSubmission(
    userId: string,
    workspaceId: string,
    id: string,
    action: "view" | "resolve" | "spam" | "legitimate" | "delete" | "restore",
    now?: Date,
  ): Promise<boolean>;
  addTag(
    userId: string,
    workspaceId: string,
    id: string,
    tag: string,
    now?: Date,
  ): Promise<boolean>;
  retrySubmission(userId: string, workspaceId: string, id: string, now?: Date): Promise<boolean>;
}

export class LocalDurableSubmissionStore implements DurableSubmissionStore {
  private readonly file: string;
  constructor(file: string, environment: "development" | "test" | "production" = "development") {
    if (environment === "production")
      throw new Error("The local durable adapter is disabled in production.");
    this.file = resolve(file);
  }
  private async read(): Promise<RootState> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as RootState;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
      throw error;
    }
  }
  private async locked<T>(
    operation: (state: RootState, phase2: Phase2State) => T | Promise<T>,
  ): Promise<T> {
    await mkdir(dirname(this.file), { recursive: true });
    const lock = `${this.file}.lock`;
    const deadline = Date.now() + 5_000;
    while (true) {
      try {
        await mkdir(lock);
        break;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        if (Date.now() >= deadline)
          throw new Error("Timed out acquiring the local durable store lock.");
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
      }
    }
    try {
      const state = await this.read();
      const phase2 = state.phase2 ?? emptyPhase2();
      state.phase2 = phase2;
      const result = await operation(state, phase2);
      const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 });
      await rename(temporary, this.file);
      return result;
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
  private form(record: Record<string, unknown>): IngestForm {
    const captchaValue = record.captcha as IngestForm["captcha"] | undefined;
    return {
      id: String(record.id),
      workspaceId: String(record.workspaceId),
      name: String(record.name),
      endpointKey: String(record.endpointKey),
      active: record.active !== false,
      fields: (record.fields as IngestForm["fields"] | undefined) ?? [],
      allowedOrigins: (record.allowedOrigins as string[] | undefined) ?? [],
      allowNoOrigin: record.allowNoOrigin !== false,
      successRedirect: typeof record.successRedirect === "string" ? record.successRedirect : null,
      honeypotField:
        typeof record.honeypotField === "string" ? record.honeypotField : "company_website",
      notificationEmail:
        typeof record.notificationEmail === "string" ? record.notificationEmail : null,
      autoresponderRecipientField:
        typeof record.autoresponderRecipientField === "string"
          ? record.autoresponderRecipientField
          : null,
      autoresponderSubject:
        typeof record.autoresponderSubject === "string" ? record.autoresponderSubject : null,
      autoresponderBody:
        typeof record.autoresponderBody === "string" ? record.autoresponderBody : null,
      captcha: captchaValue ?? null,
      schemaVersion: typeof record.schemaVersion === "number" ? record.schemaVersion : 1,
      ingest: {
        ...defaults,
        ...(typeof record.maxBodyBytes === "number" ? { maxBodyBytes: record.maxBodyBytes } : {}),
        ...(typeof record.maxFields === "number" ? { maxFields: record.maxFields } : {}),
        ...(typeof record.maxFiles === "number" ? { maxFiles: record.maxFiles } : {}),
        ...(typeof record.maxFileBytes === "number" ? { maxFileBytes: record.maxFileBytes } : {}),
        ...(typeof record.maxTotalFileBytes === "number"
          ? { maxTotalFileBytes: record.maxTotalFileBytes }
          : {}),
        ...((record.ingest as Partial<IngestForm["ingest"]> | undefined) ?? {}),
      },
    };
  }
  async resolveForm(publicFormId: string): Promise<IngestForm | null> {
    const state = await this.read();
    const record = state.forms?.find(
      (item) => item.endpointKey === publicFormId && item.active !== false,
    );
    return record ? this.form(record) : null;
  }
  async resolveFormById(formId: string): Promise<IngestForm | null> {
    const state = await this.read();
    const record = state.forms?.find((item) => item.id === formId && item.active !== false);
    return record ? this.form(record) : null;
  }
  async accept(input: AcceptSubmissionInput): Promise<AcceptSubmissionResult> {
    return this.locked((state, phase2) => {
      const formRecord = state.forms?.find(
        (item) => item.endpointKey === input.publicFormId && item.active !== false,
      );
      if (!formRecord) throw new Error("Form unavailable during acceptance.");
      const form = this.form(formRecord);
      const now = input.now ?? new Date();
      const cutoff = now.getTime() - form.ingest.idempotencyWindowMs;
      if (input.idempotencyKey) {
        const prior = phase2.submissions.find(
          (item) =>
            item.formId === form.id &&
            item.idempotencyKey === input.idempotencyKey &&
            Date.parse(item.createdAt) >= cutoff,
        );
        if (prior)
          return prior.requestFingerprint === input.requestFingerprint
            ? { kind: "replayed" as const, submission: prior }
            : { kind: "conflict" as const };
      }
      const duplicate = phase2.submissions.find(
        (item) =>
          item.formId === form.id &&
          item.requestFingerprint === input.requestFingerprint &&
          Date.parse(item.createdAt) >= now.getTime() - form.ingest.duplicateWindowMs,
      );
      const createdAt = iso(now);
      const submission: SubmissionRecord = {
        id: randomUUID(),
        requestId: input.requestId,
        formId: form.id,
        workspaceId: form.workspaceId,
        payload: input.payload,
        contentType: input.contentType,
        payloadBytes: input.payloadBytes,
        schemaVersion: form.schemaVersion,
        sourceIpHash: input.sourceIpHash,
        userAgent: input.userAgent,
        origin: input.origin,
        referrer: input.referrer,
        utm: input.utm,
        status: input.spamStatus === "blocked" ? "spam" : "new",
        previousStatus: null,
        spamStatus: input.spamStatus,
        spamScore: input.spamScore,
        spamReasons: input.spamReasons,
        test: input.test ?? false,
        processingState: "pending",
        notificationState: "pending",
        webhookState: "pending",
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: input.requestFingerprint,
        probableDuplicate: Boolean(duplicate),
        duplicateOfId: duplicate?.id ?? null,
        retentionUntil: null,
        tags: [],
        files: input.files ?? [],
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      };
      phase2.submissions.push(submission);
      phase2.events.push({
        id: randomUUID(),
        submissionId: submission.id,
        type: "submission.accepted",
        metadata: { requestId: input.requestId, probableDuplicate: Boolean(duplicate) },
        createdAt,
      });
      const dedupeKey = `process:${submission.id}`;
      if (!phase2.jobs.some((job) => job.dedupeKey === dedupeKey))
        phase2.jobs.push({
          id: randomUUID(),
          queue: "submissions",
          type: "submission.process",
          payload: { submissionId: submission.id },
          dedupeKey,
          status: "pending",
          attempts: 0,
          maxAttempts: 5,
          nextAttemptAt: createdAt,
          leaseOwner: null,
          leaseExpiresAt: null,
          completedAt: null,
          deadLetteredAt: null,
          lastError: null,
          createdAt,
          updatedAt: createdAt,
        });
      return { kind: "accepted" as const, submission };
    });
  }
  async claim(
    owner: string,
    limit: number,
    leaseMs: number,
    now = new Date(),
  ): Promise<readonly LeasedJob[]> {
    return this.locked((_state, phase2) => {
      const timestamp = now.getTime();
      for (const job of phase2.jobs) {
        if (
          job.status === "leased" &&
          job.attempts >= job.maxAttempts &&
          Boolean(job.leaseExpiresAt) &&
          Date.parse(job.leaseExpiresAt!) <= timestamp
        ) {
          job.status = "dead_letter";
          job.deadLetteredAt = iso(now);
          job.leaseOwner = null;
          job.leaseExpiresAt = null;
          job.lastError ||= "Lease expired after the maximum number of attempts.";
          job.updatedAt = iso(now);
        }
      }
      const jobs = phase2.jobs
        .filter(
          (job) =>
            job.queue === "submissions" &&
            job.attempts < job.maxAttempts &&
            (((job.status === "pending" || job.status === "retry") &&
              Date.parse(job.nextAttemptAt) <= timestamp) ||
              (job.status === "leased" &&
                Boolean(job.leaseExpiresAt) &&
                Date.parse(job.leaseExpiresAt!) <= timestamp)),
        )
        .slice(0, Math.max(0, limit));
      return jobs.map((job) => {
        job.status = "leased";
        job.attempts += 1;
        job.leaseOwner = owner;
        job.leaseExpiresAt = iso(new Date(timestamp + leaseMs));
        job.updatedAt = iso(now);
        return {
          id: job.id,
          type: job.type,
          payload: job.payload,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          leaseOwner: owner,
          leaseExpiresAt: job.leaseExpiresAt,
        };
      });
    });
  }
  async complete(jobId: string, owner: string, now = new Date()): Promise<boolean> {
    return this.locked((_state, phase2) => {
      const job = phase2.jobs.find(
        (item) =>
          item.id === jobId &&
          item.status === "leased" &&
          item.leaseOwner === owner &&
          Date.parse(item.leaseExpiresAt ?? "") > now.getTime(),
      );
      if (!job) return false;
      job.status = "completed";
      job.completedAt = iso(now);
      job.leaseOwner = null;
      job.leaseExpiresAt = null;
      job.updatedAt = iso(now);
      return true;
    });
  }
  async fail(
    jobId: string,
    owner: string,
    error: string,
    now = new Date(),
  ): Promise<"retry" | "dead_letter" | "lost_lease"> {
    return this.locked((_state, phase2) => {
      const job = phase2.jobs.find(
        (item) => item.id === jobId && item.status === "leased" && item.leaseOwner === owner,
      );
      if (!job) return "lost_lease";
      job.lastError = error.slice(0, 2_000);
      job.leaseOwner = null;
      job.leaseExpiresAt = null;
      job.updatedAt = iso(now);
      if (job.attempts >= job.maxAttempts) {
        job.status = "dead_letter";
        job.deadLetteredAt = iso(now);
        return "dead_letter";
      }
      job.status = "retry";
      job.nextAttemptAt = iso(new Date(now.getTime() + retryDelay(job.attempts)));
      return "retry";
    });
  }
  async addEvent(
    submissionId: string,
    type: string,
    metadata: Record<string, unknown> = {},
    now = new Date(),
  ): Promise<void> {
    await this.locked((_state, phase2) => {
      phase2.events.push({ id: randomUUID(), submissionId, type, metadata, createdAt: iso(now) });
    });
  }
  async getSubmissionForWorker(id: string): Promise<SubmissionRecord | null> {
    return (await this.read()).phase2?.submissions.find((item) => item.id === id) ?? null;
  }
  async updateProcessing(
    id: string,
    processingState: ProcessingState,
    now = new Date(),
  ): Promise<void> {
    await this.locked((_state, phase2) => {
      const item = phase2.submissions.find((value) => value.id === id);
      if (item) {
        item.processingState = processingState;
        item.updatedAt = iso(now);
      }
    });
  }
  async updateFileScan(
    submissionId: string,
    fileId: string,
    scanState: SubmissionFileRecord["scanState"],
    quarantineState: SubmissionFileRecord["quarantineState"],
    now = new Date(),
  ): Promise<void> {
    await this.locked((_state, phase2) => {
      const item = phase2.submissions.find((value) => value.id === submissionId);
      const file = item?.files.find((value) => value.id === fileId);
      if (item && file) {
        file.scanState = scanState;
        file.quarantineState = quarantineState;
        item.updatedAt = iso(now);
      }
    });
  }
  async upsertDelivery(
    input: Omit<DeliveryEvent, "id" | "createdAt" | "updatedAt">,
    now = new Date(),
  ): Promise<DeliveryEvent> {
    return this.locked((_state, phase2) => {
      const existing = phase2.deliveries.find((item) => item.eventKey === input.eventKey);
      if (existing) return existing;
      const delivery: DeliveryEvent = {
        ...input,
        id: randomUUID(),
        createdAt: iso(now),
        updatedAt: iso(now),
      };
      phase2.deliveries.push(delivery);
      return delivery;
    });
  }
  async updateDelivery(
    eventKey: string,
    update: Partial<
      Pick<
        DeliveryEvent,
        "status" | "attempts" | "nextAttemptAt" | "terminal" | "lastError" | "responseCode"
      >
    >,
    now = new Date(),
  ): Promise<void> {
    await this.locked((_state, phase2) => {
      const delivery = phase2.deliveries.find((item) => item.eventKey === eventKey);
      if (!delivery) return;
      Object.assign(delivery, update);
      delivery.updatedAt = iso(now);
      const submission = phase2.submissions.find((item) => item.id === delivery.submissionId);
      if (submission && delivery.destinationType === "notification")
        submission.notificationState = delivery.status;
      if (submission && delivery.destinationType === "webhook")
        submission.webhookState = delivery.status;
    });
  }
  async listWebhooks(
    workspaceId: string,
    formId: string,
    event: string,
  ): Promise<readonly WebhookEndpointRecord[]> {
    return ((await this.read()).phase2?.webhooks ?? []).filter(
      (item) =>
        item.workspaceId === workspaceId &&
        (!item.formId || item.formId === formId) &&
        item.status === "active" &&
        item.subscribedEvents.includes(event),
    );
  }
  async recordWebhookResult(
    endpointId: string,
    success: boolean,
    disableThreshold = 10,
  ): Promise<void> {
    await this.locked((_state, phase2) => {
      const endpoint = phase2.webhooks.find((item) => item.id === endpointId);
      if (!endpoint) return;
      endpoint.consecutiveFailures = success ? 0 : endpoint.consecutiveFailures + 1;
      if (endpoint.consecutiveFailures >= disableThreshold) endpoint.status = "disabled";
    });
  }
  private async authorize(
    userId: string,
    workspaceId: string,
    permission: Permission,
  ): Promise<RootState> {
    const state = await this.read();
    if (userId === SYSTEM_ACTOR_ID) return state;
    const membership = state.memberships?.find(
      (item) => item.userId === userId && item.workspaceId === workspaceId,
    );
    requirePermission(membership?.role ?? null, permission);
    return state;
  }
  async listSubmissions(
    userId: string,
    workspaceId: string,
    filter: SubmissionFilter = {},
  ): Promise<SubmissionPage> {
    const state = await this.authorize(userId, workspaceId, "submissions:read");
    const limit = Math.min(100, Math.max(1, filter.limit ?? 25));
    const query = filter.search?.toLowerCase();
    const cursor = decodeSubmissionCursor(filter.cursor);
    const filtered = (state.phase2?.submissions ?? [])
      .filter(
        (item) =>
          item.workspaceId === workspaceId &&
          (!filter.formId || item.formId === filter.formId) &&
          (!filter.status || item.status === filter.status) &&
          (!filter.spamStatus || item.spamStatus === filter.spamStatus) &&
          (!filter.from || Date.parse(item.createdAt) >= filter.from.getTime()) &&
          (!filter.to || Date.parse(item.createdAt) <= filter.to.getTime()) &&
          (!cursor ||
            item.createdAt < cursor.createdAt ||
            (item.createdAt === cursor.createdAt && item.id < cursor.id)) &&
          (!query || JSON.stringify(item.payload).toLowerCase().includes(query)),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    const items = filtered.slice(0, limit);
    return {
      items,
      nextCursor:
        filtered.length > limit && items.at(-1)
          ? encodeSubmissionCursor({ createdAt: items.at(-1)!.createdAt, id: items.at(-1)!.id })
          : null,
    };
  }
  async getSubmission(
    userId: string,
    workspaceId: string,
    id: string,
  ): Promise<{
    submission: SubmissionRecord;
    events: SubmissionEvent[];
    deliveries: DeliveryEvent[];
  } | null> {
    const state = await this.authorize(userId, workspaceId, "submissions:read");
    const submission = state.phase2?.submissions.find(
      (item) => item.id === id && item.workspaceId === workspaceId,
    );
    if (!submission) return null;
    return {
      submission,
      events: (state.phase2?.events ?? []).filter((item) => item.submissionId === id),
      deliveries: (state.phase2?.deliveries ?? []).filter((item) => item.submissionId === id),
    };
  }
  async updateSubmission(
    userId: string,
    workspaceId: string,
    id: string,
    action: "view" | "resolve" | "spam" | "legitimate" | "delete" | "restore",
    now = new Date(),
  ): Promise<boolean> {
    await this.authorize(userId, workspaceId, "submissions:update");
    return this.locked((_state, phase2) => {
      const item = phase2.submissions.find(
        (value) => value.id === id && value.workspaceId === workspaceId,
      );
      if (!item) return false;
      const transitions: Record<typeof action, SubmissionStatus> = {
        view: "viewed",
        resolve: "resolved",
        spam: "spam",
        legitimate: "new",
        delete: "deleted",
        restore: item.previousStatus ?? "new",
      };
      if (action === "restore" && item.status !== "deleted") return false;
      if (action === "delete" && item.status === "deleted") return false;
      if (action === "delete") {
        item.previousStatus = item.status;
        item.deletedAt = iso(now);
      }
      if (action === "restore") {
        item.deletedAt = null;
        item.previousStatus = null;
      }
      item.status = transitions[action];
      if (action === "spam") item.spamStatus = "blocked";
      if (action === "legitimate") item.spamStatus = "allowed";
      item.updatedAt = iso(now);
      phase2.events.push({
        id: randomUUID(),
        submissionId: id,
        type: `submission.${action}`,
        metadata: {},
        createdAt: iso(now),
      });
      return true;
    });
  }
  async addTag(
    userId: string,
    workspaceId: string,
    id: string,
    tag: string,
    now = new Date(),
  ): Promise<boolean> {
    await this.authorize(userId, workspaceId, "submissions:update");
    const normalized = tag.trim().slice(0, 40);
    if (!normalized) return false;
    return this.locked((_state, phase2) => {
      const item = phase2.submissions.find(
        (value) => value.id === id && value.workspaceId === workspaceId,
      );
      if (!item) return false;
      if (!item.tags.includes(normalized)) item.tags.push(normalized);
      item.updatedAt = iso(now);
      return true;
    });
  }
  async retrySubmission(
    userId: string,
    workspaceId: string,
    id: string,
    now = new Date(),
  ): Promise<boolean> {
    await this.authorize(userId, workspaceId, "submissions:update");
    return this.locked((_state, phase2) => {
      const item = phase2.submissions.find(
        (value) => value.id === id && value.workspaceId === workspaceId,
      );
      if (!item || item.status === "deleted") return false;
      const dedupeKey = `manual:${id}:${now.getTime()}`;
      phase2.jobs.push({
        id: randomUUID(),
        queue: "submissions",
        type: "submission.process",
        payload: { submissionId: id, replay: true },
        dedupeKey,
        status: "pending",
        attempts: 0,
        maxAttempts: 5,
        nextAttemptAt: iso(now),
        leaseOwner: null,
        leaseExpiresAt: null,
        completedAt: null,
        deadLetteredAt: null,
        lastError: null,
        createdAt: iso(now),
        updatedAt: iso(now),
      });
      return true;
    });
  }
}

export function safeCsvCell(value: unknown): string {
  let text = String(value ?? "")
    .replaceAll("\r", " ")
    .replaceAll("\n", " ");
  if (/^[=+\-@\t]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function fingerprintPayload(payload: Record<string, unknown>): string {
  const stable = Object.keys(payload)
    .sort()
    .map((key) => [key, payload[key]]);
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}
export function createLocalDurableSubmissionStore(
  file = process.env.FORMSENTINEL_LOCAL_DATA_FILE || ".formsentinel/dev-data.json",
): LocalDurableSubmissionStore {
  return new LocalDurableSubmissionStore(
    file,
    (process.env.NODE_ENV as "development" | "test") || "development",
  );
}
export * from "./postgres";
