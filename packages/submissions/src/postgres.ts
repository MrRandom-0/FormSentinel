import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { retryDelay, type LeasedJob } from "@formsentinel/queue";
import { catalog, type PlanId } from "@formsentinel/entitlements";
import { requirePermission, type Permission, type WorkspaceRole } from "@formsentinel/auth";
import type {
  AcceptSubmissionInput,
  AcceptSubmissionResult,
  DeliveryEvent,
  DurableSubmissionStore,
  IngestForm,
  ProcessingState,
  SubmissionEvent,
  SubmissionFileRecord,
  SubmissionFilter,
  SubmissionPage,
  SubmissionRecord,
  SubmissionStatus,
  WebhookEndpointRecord,
} from "./index";

type Row = Record<string, unknown>;
export type SecretDecryptor = (encrypted: string) => Promise<string>;
const dateString = (value: unknown): string =>
  value instanceof Date ? value.toISOString() : String(value);
const decodeCursor = (value?: string): { createdAt: string; id: string } | null => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      createdAt: string;
      id: string;
    };
    return parsed.id && Number.isFinite(Date.parse(parsed.createdAt)) ? parsed : null;
  } catch {
    return Number.isFinite(Date.parse(value))
      ? { createdAt: value, id: "ffffffff-ffff-ffff-ffff-ffffffffffff" }
      : null;
  }
};
const encodeCursor = (createdAt: string, id: string): string =>
  Buffer.from(JSON.stringify({ createdAt, id })).toString("base64url");
const delivery = (row: Row): DeliveryEvent => ({
  id: String(row.id),
  eventKey: String(row.event_key),
  idempotencyKey: String(row.idempotency_key),
  submissionId: String(row.submission_id),
  destinationType: row.destination_type as DeliveryEvent["destinationType"],
  destination: String(row.destination),
  status: row.status as DeliveryEvent["status"],
  attempts: Number(row.attempts),
  maxAttempts: Number(row.max_attempts),
  nextAttemptAt: dateString(row.next_attempt_at),
  terminal: Boolean(row.terminal),
  lastError: row.last_error ? String(row.last_error) : null,
  responseCode: row.response_code === null ? null : Number(row.response_code),
  createdAt: dateString(row.created_at),
  updatedAt: dateString(row.updated_at),
});
const fileRecord = (row: Row): SubmissionFileRecord => ({
  id: String(row.id),
  fieldName: String(row.field_name),
  originalFilename: String(row.filename),
  storageKey: String(row.storage_key),
  declaredType: String(row.content_type),
  detectedType: String(row.detected_type),
  byteSize: Number(row.byte_size),
  checksumSha256: String(row.checksum_sha256),
  quarantineState: row.quarantine_state as SubmissionFileRecord["quarantineState"],
  scanState: row.scan_state as SubmissionFileRecord["scanState"],
});
const submission = (row: Row, files: SubmissionFileRecord[] = []): SubmissionRecord => ({
  id: String(row.id),
  requestId: String(row.request_id),
  formId: String(row.form_id),
  workspaceId: String(row.workspace_id),
  payload: row.payload as SubmissionRecord["payload"],
  contentType: String(row.content_type),
  payloadBytes: Number(row.payload_bytes),
  schemaVersion: Number(row.schema_version),
  sourceIpHash: String(row.source_ip_hash),
  userAgent: row.user_agent ? String(row.user_agent) : null,
  origin: row.origin ? String(row.origin) : null,
  referrer: row.referrer ? String(row.referrer) : null,
  utm: (row.utm ?? {}) as Record<string, string>,
  status: row.status as SubmissionStatus,
  previousStatus: row.previous_status ? (String(row.previous_status) as SubmissionStatus) : null,
  spamStatus: row.spam_status as SubmissionRecord["spamStatus"],
  spamScore: Number(row.spam_score),
  spamReasons: row.spam_reasons as string[],
  test: Boolean(row.test),
  processingState: row.processing_state as ProcessingState,
  notificationState: row.notification_state as DeliveryEvent["status"],
  webhookState: row.webhook_state as DeliveryEvent["status"],
  idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
  requestFingerprint: String(row.request_fingerprint),
  probableDuplicate: Boolean(row.probable_duplicate),
  duplicateOfId: row.duplicate_of_id ? String(row.duplicate_of_id) : null,
  retentionUntil: row.retention_until ? dateString(row.retention_until) : null,
  tags: (row.tags ?? []) as string[],
  files,
  createdAt: dateString(row.created_at),
  updatedAt: dateString(row.updated_at),
  deletedAt: row.deleted_at ? dateString(row.deleted_at) : null,
});

export class MonthlySubmissionQuotaError extends Error {
  constructor(
    readonly limit: number,
    readonly used: number,
  ) {
    super("Monthly submission quota reached.");
    this.name = "MonthlySubmissionQuotaError";
  }
}

export class PostgresDurableSubmissionStore implements DurableSubmissionStore {
  readonly pool: Pool;
  constructor(
    connection: string | Pool,
    private readonly decryptSecret: SecretDecryptor = async () => {
      throw new Error("A production secret decryptor is required.");
    },
  ) {
    this.pool =
      typeof connection === "string" ? new Pool({ connectionString: connection }) : connection;
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
  private async form(row: Row): Promise<IngestForm> {
    const captcha =
      row.captcha_provider && row.captcha_secret_encrypted
        ? {
            provider: row.captcha_provider as "turnstile" | "development",
            secret: await this.decryptSecret(String(row.captcha_secret_encrypted)),
          }
        : null;
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      name: String(row.name),
      endpointKey: String(row.public_key),
      active: Boolean(row.active),
      fields: (row.fields ?? []) as IngestForm["fields"],
      allowedOrigins: (row.allowed_origins ?? []) as string[],
      allowNoOrigin: Boolean(row.allow_no_origin),
      successRedirect: row.success_redirect ? String(row.success_redirect) : null,
      honeypotField: String(row.honeypot_field),
      notificationEmail: row.notification_email ? String(row.notification_email) : null,
      autoresponderRecipientField: row.autoresponder_recipient_field
        ? String(row.autoresponder_recipient_field)
        : null,
      autoresponderSubject: row.autoresponder_subject ? String(row.autoresponder_subject) : null,
      autoresponderBody: row.autoresponder_body ? String(row.autoresponder_body) : null,
      captcha,
      schemaVersion: Number(row.schema_version),
      ingest: {
        maxBodyBytes: Number(row.max_body_bytes),
        maxFields: Number(row.max_fields),
        maxFiles: Number(row.max_files),
        maxFileBytes: Number(row.max_file_bytes),
        maxTotalFileBytes: Number(row.max_total_file_bytes),
        idempotencyWindowMs: Number(row.idempotency_window_seconds) * 1000,
        duplicateWindowMs: Number(row.duplicate_window_seconds) * 1000,
      },
    };
  }
  private formQuery(where: string) {
    return `SELECT f.*, fe.public_key,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('name', ff.name, 'type', ff.type, 'required', ff.required) ORDER BY ff.position) FROM form_schemas fs JOIN form_schema_versions fsv ON fsv.id=fs.active_version_id JOIN form_fields ff ON ff.schema_version_id=fsv.id WHERE fs.form_id=f.id), '[]'::jsonb) fields,
    (SELECT destination FROM notification_destinations nd WHERE nd.form_id=f.id AND nd.active AND nd.channel='email' LIMIT 1) notification_email,
    (SELECT recipient_field FROM autoresponders ar WHERE ar.form_id=f.id AND ar.active LIMIT 1) autoresponder_recipient_field,
    (SELECT subject FROM autoresponders ar WHERE ar.form_id=f.id AND ar.active LIMIT 1) autoresponder_subject,
    (SELECT body FROM autoresponders ar WHERE ar.form_id=f.id AND ar.active LIMIT 1) autoresponder_body,
    cc.provider captcha_provider, cc.secret_encrypted captcha_secret_encrypted
    FROM forms f JOIN form_endpoints fe ON fe.form_id=f.id LEFT JOIN form_captcha_configurations cc ON cc.form_id=f.id AND cc.active WHERE ${where} LIMIT 1`;
  }
  async resolveForm(publicFormId: string): Promise<IngestForm | null> {
    const result = await this.pool.query<Row>(this.formQuery("fe.public_key=$1 AND f.active"), [
      publicFormId,
    ]);
    return result.rows[0] ? this.form(result.rows[0]) : null;
  }
  async resolveFormById(formId: string): Promise<IngestForm | null> {
    const result = await this.pool.query<Row>(this.formQuery("f.id=$1 AND f.active"), [formId]);
    return result.rows[0] ? this.form(result.rows[0]) : null;
  }
  async accept(input: AcceptSubmissionInput): Promise<AcceptSubmissionResult> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const form = await client.query<Row>(
        "SELECT f.* FROM forms f JOIN form_endpoints fe ON fe.form_id=f.id WHERE fe.public_key=$1 AND f.active FOR SHARE",
        [input.publicFormId],
      );
      const current = form.rows[0];
      if (!current) throw new Error("Form unavailable during acceptance.");
      const now = input.now ?? new Date();
      const formId = String(current.id);
      const workspaceId = String(current.workspace_id);
      const idempotencySeconds = Number(current.idempotency_window_seconds ?? 86400);
      if (input.idempotencyKey) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
          `${formId}:${input.idempotencyKey}`,
        ]);
        const prior = await client.query<Row>(
          "SELECT s.*, COALESCE((SELECT jsonb_agg(tag) FROM submission_tags WHERE submission_id=s.id), '[]') tags FROM submissions s WHERE form_id=$1 AND idempotency_key=$2 AND created_at >= $3::timestamptz - ($4 * interval '1 second') ORDER BY created_at DESC LIMIT 1",
          [formId, input.idempotencyKey, now, idempotencySeconds],
        );
        if (prior.rows[0]) {
          await client.query("COMMIT");
          return prior.rows[0].request_fingerprint === input.requestFingerprint
            ? { kind: "replayed", submission: submission(prior.rows[0]) }
            : { kind: "conflict" };
        }
      }
      // Serialize quota acceptance per monthly workspace bucket. Idempotent replay is resolved above,
      // so a replay remains available after the hard quota has been reached.
      const bucketMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      const workspacePlan = await client.query<{ plan: PlanId }>(
        "SELECT plan FROM workspaces WHERE id=$1 FOR SHARE",
        [workspaceId],
      );
      const plan = workspacePlan.rows[0]?.plan ?? "free";
      const monthlyLimit = catalog[plan].limits.monthlySubmissions;
      await client.query(
        "INSERT INTO usage_counters (workspace_id,metric,bucket_month,committed,reserved) VALUES ($1,'monthlySubmissions',$2,0,0) ON CONFLICT DO NOTHING",
        [workspaceId, bucketMonth],
      );
      const counter = await client.query<{ committed: number; reserved: number }>(
        "SELECT committed,reserved FROM usage_counters WHERE workspace_id=$1 AND metric='monthlySubmissions' AND bucket_month=$2 FOR UPDATE",
        [workspaceId, bucketMonth],
      );
      const committed = Number(counter.rows[0]?.committed ?? 0);
      const reserved = Number(counter.rows[0]?.reserved ?? 0);
      if (committed + reserved + 1 > monthlyLimit)
        throw new MonthlySubmissionQuotaError(monthlyLimit, committed + reserved);
      const duplicateSeconds = Number(current.duplicate_window_seconds ?? 3600);
      const priorDuplicate = await client.query<Row>(
        "SELECT id FROM submissions WHERE form_id=$1 AND request_fingerprint=$2 AND created_at >= $3::timestamptz - ($4 * interval '1 second') ORDER BY created_at DESC LIMIT 1",
        [formId, input.requestFingerprint, now, duplicateSeconds],
      );
      const id = randomUUID();
      const inserted = await client.query<Row>(
        `INSERT INTO submissions (id,request_id,form_id,workspace_id,payload,content_type,payload_bytes,schema_version,source_ip_hash,user_agent,origin,referrer,utm,status,spam_status,spam_score,spam_reasons,test,processing_state,notification_state,webhook_state,idempotency_key,request_fingerprint,probable_duplicate,duplicate_of_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'pending','pending','pending',$19,$20,$21,$22,$23,$23) RETURNING *`,
        [
          id,
          input.requestId,
          formId,
          workspaceId,
          input.payload,
          input.contentType,
          input.payloadBytes,
          Number(current.schema_version ?? 1),
          input.sourceIpHash,
          input.userAgent,
          input.origin,
          input.referrer,
          input.utm,
          input.spamStatus === "blocked" ? "spam" : "new",
          input.spamStatus,
          input.spamScore,
          input.spamReasons,
          input.test ?? false,
          input.idempotencyKey,
          input.requestFingerprint,
          Boolean(priorDuplicate.rows[0]),
          priorDuplicate.rows[0]?.id ?? null,
          now,
        ],
      );
      for (const file of input.files ?? [])
        await client.query(
          "INSERT INTO submission_files (id,submission_id,field_name,storage_key,filename,content_type,detected_type,byte_size,checksum_sha256,quarantine_state,scan_state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
          [
            file.id,
            id,
            file.fieldName,
            file.storageKey,
            file.originalFilename,
            file.declaredType,
            file.detectedType,
            file.byteSize,
            file.checksumSha256,
            file.quarantineState,
            file.scanState,
          ],
        );
      await client.query(
        "INSERT INTO submission_events (submission_id,type,metadata,created_at) VALUES ($1,'submission.accepted',$2,$3)",
        [
          id,
          { requestId: input.requestId, probableDuplicate: Boolean(priorDuplicate.rows[0]) },
          now,
        ],
      );
      await client.query(
        "INSERT INTO usage_events (workspace_id,metric,quantity,source_type,source_id,bucket_month,correlation_id,occurred_at,metadata) VALUES ($1,'monthlySubmissions',1,'submission',$2,$3,$4,$5,$6) ON CONFLICT (workspace_id,metric,source_type,source_id) DO NOTHING",
        [
          workspaceId,
          id,
          bucketMonth,
          input.requestId,
          now,
          { test: input.test ?? false, spamStatus: input.spamStatus },
        ],
      );
      await client.query(
        "UPDATE usage_counters SET committed=committed+1,updated_at=$3 WHERE workspace_id=$1 AND metric='monthlySubmissions' AND bucket_month=$2",
        [workspaceId, bucketMonth, now],
      );
      for (const threshold of [80, 100, 120] as const) {
        if (
          committed * 100 < monthlyLimit * threshold &&
          (committed + 1) * 100 >= monthlyLimit * threshold
        )
          await client.query(
            "INSERT INTO submission_events (submission_id,type,metadata,created_at) VALUES ($1,'usage.threshold',$2,$3)",
            [id, { metric: "monthlySubmissions", threshold, limit: monthlyLimit }, now],
          );
      }
      await client.query(
        "INSERT INTO background_jobs (queue,type,payload,dedupe_key,status,next_attempt_at,available_at) VALUES ('submissions','submission.process',$1,$2,'pending',$3,$3) ON CONFLICT (queue,dedupe_key) DO NOTHING",
        [{ submissionId: id }, `process:${id}`, now],
      );
      await client.query("COMMIT");
      return {
        kind: "accepted",
        submission: submission(inserted.rows[0]!, input.files ? [...input.files] : []),
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async claim(
    owner: string,
    limit: number,
    leaseMs: number,
    now = new Date(),
  ): Promise<readonly LeasedJob[]> {
    await this.pool.query(
      "UPDATE background_jobs SET status='dead_letter',dead_lettered_at=$1,lease_owner=NULL,lease_expires_at=NULL,last_error=COALESCE(last_error,'Lease expired after the maximum number of attempts.'),updated_at=$1 WHERE queue='submissions' AND status='leased' AND lease_expires_at <= $1 AND attempts >= max_attempts",
      [now],
    );
    const result = await this.pool.query<Row>(
      `WITH candidates AS (SELECT id FROM background_jobs WHERE queue='submissions' AND attempts < max_attempts AND (((status IN ('pending','retry')) AND next_attempt_at <= $1) OR (status='leased' AND lease_expires_at <= $1)) ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT $2) UPDATE background_jobs j SET status='leased',attempts=j.attempts+1,lease_owner=$3,lease_expires_at=$1::timestamptz+($4*interval '1 millisecond'),locked_at=$1,updated_at=$1 FROM candidates c WHERE j.id=c.id RETURNING j.*`,
      [now, limit, owner, leaseMs],
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      type: String(row.type),
      payload: row.payload,
      attempts: Number(row.attempts),
      maxAttempts: Number(row.max_attempts),
      leaseOwner: owner,
      leaseExpiresAt: dateString(row.lease_expires_at),
    }));
  }
  async complete(jobId: string, owner: string, now = new Date()): Promise<boolean> {
    const result = await this.pool.query(
      "UPDATE background_jobs SET status='completed',completed_at=$3,lease_owner=NULL,lease_expires_at=NULL,updated_at=$3 WHERE id=$1 AND status='leased' AND lease_owner=$2 AND lease_expires_at>$3",
      [jobId, owner, now],
    );
    return Boolean(result.rowCount);
  }
  async fail(
    jobId: string,
    owner: string,
    error: string,
    now = new Date(),
  ): Promise<"retry" | "dead_letter" | "lost_lease"> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<Row>(
        "SELECT * FROM background_jobs WHERE id=$1 AND status='leased' AND lease_owner=$2 FOR UPDATE",
        [jobId, owner],
      );
      const job = result.rows[0];
      if (!job) {
        await client.query("ROLLBACK");
        return "lost_lease";
      }
      const dead = Number(job.attempts) >= Number(job.max_attempts);
      await client.query(
        `UPDATE background_jobs SET status=$2,last_error=$3,lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=$4,dead_lettered_at=$5,updated_at=$6 WHERE id=$1`,
        [
          jobId,
          dead ? "dead_letter" : "retry",
          error.slice(0, 2000),
          new Date(now.getTime() + retryDelay(Number(job.attempts))),
          dead ? now : null,
          now,
        ],
      );
      await client.query("COMMIT");
      return dead ? "dead_letter" : "retry";
    } catch (errorValue) {
      await client.query("ROLLBACK");
      throw errorValue;
    } finally {
      client.release();
    }
  }
  async addEvent(
    submissionId: string,
    type: string,
    metadata: Record<string, unknown> = {},
    now = new Date(),
  ): Promise<void> {
    await this.pool.query(
      "INSERT INTO submission_events (submission_id,type,metadata,created_at) VALUES ($1,$2,$3,$4)",
      [submissionId, type, metadata, now],
    );
  }
  private async fullSubmission(
    id: string,
    client: Pool | PoolClient = this.pool,
  ): Promise<SubmissionRecord | null> {
    const result = await client.query<Row>(
      "SELECT s.*,COALESCE((SELECT jsonb_agg(tag) FROM submission_tags WHERE submission_id=s.id),'[]') tags FROM submissions s WHERE s.id=$1",
      [id],
    );
    if (!result.rows[0]) return null;
    const files = await client.query<Row>("SELECT * FROM submission_files WHERE submission_id=$1", [
      id,
    ]);
    return submission(result.rows[0], files.rows.map(fileRecord));
  }
  getSubmissionForWorker(id: string) {
    return this.fullSubmission(id);
  }
  async updateProcessing(id: string, state: ProcessingState, now = new Date()): Promise<void> {
    await this.pool.query("UPDATE submissions SET processing_state=$2,updated_at=$3 WHERE id=$1", [
      id,
      state,
      now,
    ]);
  }
  async updateFileScan(
    submissionId: string,
    fileId: string,
    scanState: SubmissionFileRecord["scanState"],
    quarantineState: SubmissionFileRecord["quarantineState"],
    now = new Date(),
  ): Promise<void> {
    await this.pool.query(
      "UPDATE submission_files SET scan_state=$3,quarantine_state=$4 WHERE id=$2 AND submission_id=$1",
      [submissionId, fileId, scanState, quarantineState],
    );
    await this.pool.query("UPDATE submissions SET updated_at=$2 WHERE id=$1", [submissionId, now]);
  }
  async upsertDelivery(
    input: Omit<DeliveryEvent, "id" | "createdAt" | "updatedAt">,
    now = new Date(),
  ): Promise<DeliveryEvent> {
    const result = await this.pool.query<Row>(
      `INSERT INTO delivery_events (event_key,idempotency_key,submission_id,destination_type,destination,status,attempts,max_attempts,next_attempt_at,terminal,last_error,response_code,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) ON CONFLICT(event_key) DO UPDATE SET event_key=EXCLUDED.event_key RETURNING *`,
      [
        input.eventKey,
        input.idempotencyKey,
        input.submissionId,
        input.destinationType,
        input.destination,
        input.status,
        input.attempts,
        input.maxAttempts,
        input.nextAttemptAt,
        input.terminal,
        input.lastError,
        input.responseCode,
        now,
      ],
    );
    return delivery(result.rows[0]!);
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
    const current = await this.pool.query<Row>("SELECT * FROM delivery_events WHERE event_key=$1", [
      eventKey,
    ]);
    if (!current.rows[0]) return;
    const merged = { ...delivery(current.rows[0]), ...update };
    await this.pool.query(
      "UPDATE delivery_events SET status=$2,attempts=$3,next_attempt_at=$4,terminal=$5,last_error=$6,response_code=$7,updated_at=$8 WHERE event_key=$1",
      [
        eventKey,
        merged.status,
        merged.attempts,
        merged.nextAttemptAt,
        merged.terminal,
        merged.lastError,
        merged.responseCode,
        now,
      ],
    );
    if (merged.destinationType === "notification")
      await this.pool.query(
        "UPDATE submissions SET notification_state=$2,updated_at=$3 WHERE id=$1",
        [merged.submissionId, merged.status, now],
      );
    if (merged.destinationType === "webhook")
      await this.pool.query("UPDATE submissions SET webhook_state=$2,updated_at=$3 WHERE id=$1", [
        merged.submissionId,
        merged.status,
        now,
      ]);
  }
  async listWebhooks(
    workspaceId: string,
    formId: string,
    event: string,
  ): Promise<readonly WebhookEndpointRecord[]> {
    const result = await this.pool.query<Row>(
      "SELECT * FROM webhook_endpoints WHERE workspace_id=$1 AND (form_id IS NULL OR form_id=$2) AND active AND status='active' AND subscribed_events ? $3",
      [workspaceId, formId, event],
    );
    return Promise.all(
      result.rows.map(async (row) => ({
        id: String(row.id),
        workspaceId: String(row.workspace_id),
        formId: row.form_id ? String(row.form_id) : null,
        url: String(row.url),
        secret: await this.decryptSecret(String(row.secret_encrypted)),
        previousSecret: row.previous_secret_encrypted
          ? await this.decryptSecret(String(row.previous_secret_encrypted))
          : null,
        previousSecretExpiresAt: row.previous_secret_expires_at
          ? dateString(row.previous_secret_expires_at)
          : null,
        subscribedEvents: row.subscribed_events as string[],
        status: row.status as "active" | "disabled",
        consecutiveFailures: Number(row.consecutive_failures),
      })),
    );
  }
  async recordWebhookResult(
    endpointId: string,
    success: boolean,
    disableThreshold = 10,
    now = new Date(),
  ): Promise<void> {
    await this.pool.query(
      "UPDATE webhook_endpoints SET consecutive_failures=CASE WHEN $2 THEN 0 ELSE consecutive_failures+1 END,status=CASE WHEN NOT $2 AND consecutive_failures+1 >= $3 THEN 'disabled' ELSE status END,active=CASE WHEN NOT $2 AND consecutive_failures+1 >= $3 THEN false ELSE active END,disabled_at=CASE WHEN NOT $2 AND consecutive_failures+1 >= $3 THEN $4 ELSE disabled_at END,updated_at=$4 WHERE id=$1",
      [endpointId, success, disableThreshold, now],
    );
  }
  private async authorize(
    userId: string,
    workspaceId: string,
    permission: Permission,
  ): Promise<void> {
    const result = await this.pool.query<{ role: WorkspaceRole }>(
      "SELECT role FROM workspace_members WHERE user_id=$1 AND workspace_id=$2",
      [userId, workspaceId],
    );
    requirePermission(result.rows[0]?.role ?? null, permission);
  }
  async listSubmissions(
    userId: string,
    workspaceId: string,
    filter: SubmissionFilter = {},
  ): Promise<SubmissionPage> {
    await this.authorize(userId, workspaceId, "submissions:read");
    const limit = Math.min(100, Math.max(1, filter.limit ?? 25));
    const cursor = decodeCursor(filter.cursor);
    const result = await this.pool.query<Row>(
      `SELECT s.*,COALESCE((SELECT jsonb_agg(tag) FROM submission_tags WHERE submission_id=s.id),'[]') tags FROM submissions s WHERE workspace_id=$1 AND ($2::uuid IS NULL OR form_id=$2) AND ($3::text IS NULL OR status=$3) AND ($4::text IS NULL OR spam_status=$4) AND ($5::timestamptz IS NULL OR created_at >= $5) AND ($6::timestamptz IS NULL OR created_at <= $6) AND ($7::timestamptz IS NULL OR (created_at,id) < ($7,$8::uuid)) AND ($9::text IS NULL OR payload::text ILIKE '%'||$9||'%') ORDER BY created_at DESC,id DESC LIMIT $10`,
      [
        workspaceId,
        filter.formId ?? null,
        filter.status ?? null,
        filter.spamStatus ?? null,
        filter.from ?? null,
        filter.to ?? null,
        cursor?.createdAt ?? null,
        cursor?.id ?? null,
        filter.search ?? null,
        limit + 1,
      ],
    );
    const items = result.rows.slice(0, limit).map((row) => submission(row));
    return {
      items,
      nextCursor:
        result.rows.length > limit && items.at(-1)
          ? encodeCursor(items.at(-1)!.createdAt, items.at(-1)!.id)
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
    await this.authorize(userId, workspaceId, "submissions:read");
    const record = await this.fullSubmission(id);
    if (!record || record.workspaceId !== workspaceId) return null;
    const events = await this.pool.query<Row>(
      "SELECT * FROM submission_events WHERE submission_id=$1 ORDER BY created_at",
      [id],
    );
    const deliveries = await this.pool.query<Row>(
      "SELECT * FROM delivery_events WHERE submission_id=$1 ORDER BY created_at",
      [id],
    );
    return {
      submission: record,
      events: events.rows.map((row) => ({
        id: String(row.id),
        submissionId: id,
        type: String(row.type),
        metadata: row.metadata as Record<string, unknown>,
        createdAt: dateString(row.created_at),
      })),
      deliveries: deliveries.rows.map(delivery),
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
    const statuses = {
      view: "viewed",
      resolve: "resolved",
      spam: "spam",
      legitimate: "new",
      delete: "deleted",
      restore: "new",
    };
    const result = await this.pool.query(
      "WITH updated AS (UPDATE submissions SET status=CASE WHEN $3='restore' THEN COALESCE(previous_status,'new') ELSE $4 END,previous_status=CASE WHEN $3='delete' THEN status WHEN $3='restore' THEN NULL ELSE previous_status END,spam_status=CASE WHEN $3='spam' THEN 'blocked' WHEN $3='legitimate' THEN 'allowed' ELSE spam_status END,deleted_at=CASE WHEN $3='delete' THEN $5 WHEN $3='restore' THEN NULL ELSE deleted_at END,updated_at=$5 WHERE id=$1 AND workspace_id=$2 AND ($3<>'restore' OR status='deleted') AND ($3<>'delete' OR status<>'deleted') RETURNING id) INSERT INTO submission_events (submission_id,type,metadata,created_at) SELECT id,'submission.'||$3,'{}'::jsonb,$5 FROM updated RETURNING submission_id",
      [id, workspaceId, action, statuses[action], now],
    );
    return Boolean(result.rowCount);
  }
  async addTag(userId: string, workspaceId: string, id: string, tag: string): Promise<boolean> {
    await this.authorize(userId, workspaceId, "submissions:update");
    const normalized = tag.trim().slice(0, 40);
    if (!normalized) return false;
    const result = await this.pool.query(
      "INSERT INTO submission_tags (submission_id,tag) SELECT id,$3 FROM submissions WHERE id=$1 AND workspace_id=$2 ON CONFLICT DO NOTHING",
      [id, workspaceId, normalized],
    );
    return Boolean(result.rowCount);
  }
  async retrySubmission(
    userId: string,
    workspaceId: string,
    id: string,
    now = new Date(),
  ): Promise<boolean> {
    await this.authorize(userId, workspaceId, "submissions:update");
    const result = await this.pool.query(
      "INSERT INTO background_jobs (queue,type,payload,dedupe_key,status,next_attempt_at,available_at) SELECT 'submissions','submission.process',jsonb_build_object('submissionId',id,'replay',true),$3,'pending',$4,$4 FROM submissions WHERE id=$1 AND workspace_id=$2 AND status<>'deleted'",
      [id, workspaceId, `manual:${id}:${now.getTime()}`, now],
    );
    return Boolean(result.rowCount);
  }
}
