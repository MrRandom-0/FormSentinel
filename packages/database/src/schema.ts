import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("workspace_role", [
  "owner",
  "administrator",
  "developer",
  "analyst",
  "viewer",
]);
export const planEnum = pgEnum("plan_id", ["free", "starter", "pro", "agency"]);
export const tokenKindEnum = pgEnum("token_kind", ["verify_email", "magic_link", "password_reset"]);
export const deliveryStatusEnum = pgEnum("delivery_status", [
  "pending",
  "processing",
  "delivered",
  "failed",
]);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    passwordHash: text("password_hash"),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    deletionRequestedAt: timestamp("deletion_requested_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_unique").on(sql`lower(${t.email})`)],
);
export const authTokens = pgTable("auth_tokens", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: tokenKindEnum("kind").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: createdAt(),
});
export const userSessions = pgTable(
  "user_sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    deviceLabel: text("device_label").notNull(),
    ipHash: text("ip_hash").notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("user_sessions_user_idx").on(t.userId)],
);
export const workspaces = pgTable(
  "workspaces",
  {
    id: id(),
    name: text("name").notNull(),
    slug: text("slug").notNull().unique(),
    plan: planEnum("plan").notNull().default("free"),
    lifecycleState: text("lifecycle_state").notNull().default("active"),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    deletionScheduledAt: timestamp("deletion_scheduled_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("workspaces_lifecycle_idx").on(t.lifecycleState, t.updatedAt),
    check(
      "workspaces_lifecycle_valid",
      sql`${t.lifecycleState} IN ('active', 'restricted', 'suspended', 'deleting', 'deleted')`,
    ),
  ],
);
export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index("workspace_members_user_idx").on(t.userId),
  ],
);
export const invitations = pgTable("invitations", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  role: roleEnum("role").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  createdAt: createdAt(),
});
export const onboardingProgress = pgTable("onboarding_progress", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  useCase: text("use_case"),
  currentStep: integer("current_step").notNull().default(1),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  updatedAt: updatedAt(),
});

export const forms = pgTable(
  "forms",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    platform: text("platform"),
    template: text("template"),
    sourceUrl: text("source_url"),
    successRedirect: text("success_redirect"),
    allowedOrigins: jsonb("allowed_origins").notNull().default([]),
    allowNoOrigin: boolean("allow_no_origin").notNull().default(true),
    honeypotField: text("honeypot_field").notNull().default("company_website"),
    schemaVersion: integer("schema_version").notNull().default(1),
    maxBodyBytes: integer("max_body_bytes").notNull().default(1048576),
    maxFields: integer("max_fields").notNull().default(50),
    maxFiles: integer("max_files").notNull().default(5),
    maxFileBytes: integer("max_file_bytes").notNull().default(5242880),
    maxTotalFileBytes: integer("max_total_file_bytes").notNull().default(10485760),
    idempotencyWindowSeconds: integer("idempotency_window_seconds").notNull().default(86400),
    duplicateWindowSeconds: integer("duplicate_window_seconds").notNull().default(3600),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("forms_id_workspace_unique").on(t.id, t.workspaceId),
    index("forms_workspace_idx").on(t.workspaceId),
    check("forms_max_body_positive", sql`${t.maxBodyBytes} > 0`),
    check(
      "forms_file_limits_nonnegative",
      sql`${t.maxFiles} >= 0 AND ${t.maxFileBytes} > 0 AND ${t.maxTotalFileBytes} > 0`,
    ),
  ],
);
export const formDomains = pgTable(
  "form_domains",
  {
    id: id(),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("form_domains_unique").on(t.formId, t.domain)],
);
export const formCaptchaConfigurations = pgTable(
  "form_captcha_configurations",
  {
    formId: uuid("form_id")
      .primaryKey()
      .references(() => forms.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    siteKey: text("site_key").notNull(),
    secretEncrypted: text("secret_encrypted").notNull(),
    required: boolean("required").notNull().default(true),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("form_captcha_provider_valid", sql`${t.provider} IN ('turnstile', 'development')`)],
);
export const formEndpoints = pgTable("form_endpoints", {
  id: id(),
  formId: uuid("form_id")
    .notNull()
    .references(() => forms.id, { onDelete: "cascade" }),
  publicKey: text("public_key").notNull().unique(),
  createdAt: createdAt(),
});
export const formSchemas = pgTable("form_schemas", {
  id: id(),
  formId: uuid("form_id")
    .notNull()
    .references(() => forms.id, { onDelete: "cascade" }),
  activeVersionId: uuid("active_version_id"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
export const formSchemaVersions = pgTable(
  "form_schema_versions",
  {
    id: id(),
    schemaId: uuid("schema_id")
      .notNull()
      .references(() => formSchemas.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    definition: jsonb("definition").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("form_schema_versions_unique").on(t.schemaId, t.version)],
);
export const formFields = pgTable("form_fields", {
  id: id(),
  schemaVersionId: uuid("schema_version_id")
    .notNull()
    .references(() => formSchemaVersions.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  type: text("type").notNull(),
  required: boolean("required").notNull().default(false),
  position: integer("position").notNull(),
  rules: jsonb("rules").notNull().default({}),
  createdAt: createdAt(),
});

export const submissions = pgTable(
  "submissions",
  {
    id: id(),
    requestId: text("request_id").notNull(),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    schemaVersionId: uuid("schema_version_id").references(() => formSchemaVersions.id, {
      onDelete: "set null",
    }),
    schemaVersion: integer("schema_version").notNull().default(1),
    payload: jsonb("payload").notNull(),
    contentType: text("content_type").notNull().default("application/json"),
    payloadBytes: integer("payload_bytes").notNull().default(0),
    sourceIpHash: text("source_ip_hash").notNull(),
    userAgent: text("user_agent"),
    origin: text("origin"),
    referrer: text("referrer"),
    utm: jsonb("utm").notNull().default({}),
    status: text("status").notNull().default("new"),
    previousStatus: text("previous_status"),
    spamStatus: text("spam_status").notNull().default("allowed"),
    spamScore: integer("spam_score").notNull().default(0),
    spamReasons: jsonb("spam_reasons").notNull().default([]),
    test: boolean("test").notNull().default(false),
    processingState: text("processing_state").notNull().default("pending"),
    notificationState: text("notification_state").notNull().default("pending"),
    webhookState: text("webhook_state").notNull().default("pending"),
    idempotencyKey: text("idempotency_key"),
    requestFingerprint: text("request_fingerprint").notNull(),
    probableDuplicate: boolean("probable_duplicate").notNull().default(false),
    duplicateOfId: uuid("duplicate_of_id").references((): AnyPgColumn => submissions.id, {
      onDelete: "set null",
    }),
    retentionUntil: timestamp("retention_until", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("submissions_id_workspace_unique").on(t.id, t.workspaceId),
    foreignKey({
      name: "submissions_form_workspace_fk",
      columns: [t.formId, t.workspaceId],
      foreignColumns: [forms.id, forms.workspaceId],
    }).onDelete("cascade"),
    index("submissions_form_created_idx").on(t.formId, t.createdAt, t.id),
    index("submissions_workspace_created_idx").on(t.workspaceId, t.createdAt, t.id),
    index("submissions_workspace_status_created_idx").on(
      t.workspaceId,
      t.status,
      t.createdAt,
      t.id,
    ),
    index("submissions_workspace_form_status_created_idx").on(
      t.workspaceId,
      t.formId,
      t.status,
      t.createdAt,
      t.id,
    ),
    index("submissions_fingerprint_idx").on(t.formId, t.requestFingerprint, t.createdAt),
    index("submissions_idempotency_scope_idx")
      .on(t.formId, t.idempotencyKey, t.createdAt)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    index("submissions_request_id_idx").on(t.requestId),
    check("submissions_payload_bytes_nonnegative", sql`${t.payloadBytes} >= 0`),
    check("submissions_spam_score_range", sql`${t.spamScore} BETWEEN 0 AND 100`),
  ],
);
export const submissionFiles = pgTable(
  "submission_files",
  {
    id: id(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    fieldName: text("field_name").notNull().default("file"),
    storageKey: text("storage_key").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    detectedType: text("detected_type"),
    byteSize: integer("byte_size").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    quarantineState: text("quarantine_state").notNull().default("quarantined"),
    scanState: text("scan_state").notNull().default("pending"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("submission_files_storage_key_unique").on(t.storageKey),
    index("submission_files_submission_idx").on(t.submissionId),
    check("submission_files_size_nonnegative", sql`${t.byteSize} >= 0`),
  ],
);
export const submissionEvents = pgTable("submission_events", {
  id: id(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: createdAt(),
});
export const submissionTags = pgTable(
  "submission_tags",
  {
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    tag: text("tag").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.submissionId, t.tag] })],
);
export const spamDecisions = pgTable("spam_decisions", {
  id: id(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id, { onDelete: "cascade" }),
  verdict: text("verdict").notNull(),
  score: integer("score"),
  reasons: jsonb("reasons").notNull().default([]),
  createdAt: createdAt(),
});
export const spamRules = pgTable("spam_rules", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  definition: jsonb("definition").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const notificationDestinations = pgTable("notification_destinations", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  formId: uuid("form_id").references(() => forms.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  destination: text("destination").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: id(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    destinationId: uuid("destination_id")
      .notNull()
      .references(() => notificationDestinations.id, { onDelete: "cascade" }),
    eventKey: text("event_key").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: deliveryStatusEnum("status").notNull().default("pending"),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    terminal: boolean("terminal").notNull().default(false),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("notification_deliveries_event_key_unique").on(t.eventKey),
    index("notification_deliveries_retry_idx").on(t.status, t.nextAttemptAt),
  ],
);
export const autoresponders = pgTable("autoresponders", {
  id: id(),
  formId: uuid("form_id")
    .notNull()
    .references(() => forms.id, { onDelete: "cascade" }),
  fromName: text("from_name"),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  recipientField: text("recipient_field").notNull().default("email"),
  delaySeconds: integer("delay_seconds").notNull().default(0),
  suppressSpam: boolean("suppress_spam").notNull().default(true),
  suppressTest: boolean("suppress_test").notNull().default(true),
  active: boolean("active").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
export const webhookEndpoints = pgTable("webhook_endpoints", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  formId: uuid("form_id").references(() => forms.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  secretEncrypted: text("secret_encrypted").notNull(),
  previousSecretEncrypted: text("previous_secret_encrypted"),
  previousSecretExpiresAt: timestamp("previous_secret_expires_at", { withTimezone: true }),
  subscribedEvents: jsonb("subscribed_events").notNull().default(["submission.accepted"]),
  status: text("status").notNull().default("active"),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: id(),
    endpointId: uuid("endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id").references(() => submissions.id, { onDelete: "cascade" }),
    eventKey: text("event_key").notNull(),
    eventId: text("event_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: deliveryStatusEnum("status").notNull().default("pending"),
    responseCode: integer("response_code"),
    attempt: integer("attempt").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    terminal: boolean("terminal").notNull().default(false),
    lastError: text("last_error"),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("webhook_deliveries_event_key_unique").on(t.eventKey),
    uniqueIndex("webhook_deliveries_event_id_unique").on(t.eventId),
    index("webhook_deliveries_retry_idx").on(t.status, t.nextAttemptAt),
  ],
);

export const deliveryEvents = pgTable(
  "delivery_events",
  {
    id: id(),
    eventKey: text("event_key").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    destinationType: text("destination_type").notNull(),
    destination: text("destination").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    terminal: boolean("terminal").notNull().default(false),
    lastError: text("last_error"),
    responseCode: integer("response_code"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("delivery_events_event_key_unique").on(t.eventKey),
    uniqueIndex("delivery_events_idempotency_unique").on(t.idempotencyKey),
    index("delivery_events_retry_idx").on(t.status, t.nextAttemptAt),
    check("delivery_events_attempts_valid", sql`${t.attempts} >= 0 AND ${t.maxAttempts} > 0`),
  ],
);

export const integrations = pgTable("integrations", {
  id: id(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});
export const integrationConnections = pgTable(
  "integration_connections",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    integrationId: uuid("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    credentialsEncrypted: text("credentials_encrypted"),
    configuration: jsonb("configuration").notNull().default({}),
    status: text("status").notNull().default("disconnected"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("integration_connections_id_workspace_unique").on(t.id, t.workspaceId)],
);
export const healthMonitors = pgTable("health_monitors", {
  id: id(),
  formId: uuid("form_id")
    .notNull()
    .references(() => forms.id, { onDelete: "cascade" }),
  intervalMinutes: integer("interval_minutes").notNull(),
  active: boolean("active").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
export const healthRuns = pgTable("health_runs", {
  id: id(),
  monitorId: uuid("monitor_id")
    .notNull()
    .references(() => healthMonitors.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  details: jsonb("details").notNull().default({}),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt: createdAt(),
});
export const driftEvents = pgTable("drift_events", {
  id: id(),
  formId: uuid("form_id")
    .notNull()
    .references(() => forms.id, { onDelete: "cascade" }),
  previousVersionId: uuid("previous_version_id").references(() => formSchemaVersions.id, {
    onDelete: "set null",
  }),
  observedDefinition: jsonb("observed_definition").notNull(),
  status: text("status").notNull().default("open"),
  createdAt: createdAt(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const apiKeys = pgTable(
  "api_keys",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prefix: text("prefix").notNull(),
    keyHash: text("key_hash").notNull().unique(),
    scopes: jsonb("scopes").notNull().default([]),
    formGrants: jsonb("form_grants").notNull().default([]),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    rotatedFromId: uuid("rotated_from_id").references((): AnyPgColumn => apiKeys.id, {
      onDelete: "set null",
    }),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("api_keys_workspace_active_idx").on(t.workspaceId, t.revokedAt, t.expiresAt),
    index("api_keys_prefix_idx").on(t.prefix),
  ],
);
export const installationTokens = pgTable("installation_tokens", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  formId: uuid("form_id").references(() => forms.id, { onDelete: "cascade" }),
  prefix: text("prefix").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});
export const usageEvents = pgTable(
  "usage_events",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    quantity: integer("quantity").notNull().default(1),
    sourceType: text("source_type").notNull().default("legacy"),
    sourceId: text("source_id").notNull().default("legacy"),
    bucketMonth: timestamp("bucket_month", { withTimezone: true }).notNull().defaultNow(),
    correlationId: text("correlation_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (t) => [
    uniqueIndex("usage_events_source_unique").on(t.workspaceId, t.metric, t.sourceType, t.sourceId),
    index("usage_events_workspace_bucket_idx").on(t.workspaceId, t.metric, t.bucketMonth),
    check("usage_events_quantity_positive", sql`${t.quantity} > 0`),
  ],
);
export const usageCounters = pgTable(
  "usage_counters",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    bucketMonth: timestamp("bucket_month", { withTimezone: true }).notNull(),
    committed: integer("committed").notNull().default(0),
    reserved: integer("reserved").notNull().default(0),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.metric, t.bucketMonth] }),
    check("usage_counters_nonnegative", sql`${t.committed} >= 0 AND ${t.reserved} >= 0`),
  ],
);
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" })
      .unique(),
    provider: text("provider").notNull().default("stripe"),
    providerCustomerId: text("provider_customer_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    providerPriceId: text("provider_price_id"),
    plan: planEnum("plan").notNull(),
    status: text("status").notNull(),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    periodStartsAt: timestamp("period_starts_at", { withTimezone: true }),
    periodEndsAt: timestamp("period_ends_at", { withTimezone: true }),
    graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }),
    providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }),
    lastEventCreatedAt: timestamp("last_event_created_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("subscriptions_provider_customer_unique")
      .on(t.provider, t.providerCustomerId)
      .where(sql`${t.providerCustomerId} IS NOT NULL`),
    uniqueIndex("subscriptions_provider_subscription_unique")
      .on(t.provider, t.providerSubscriptionId)
      .where(sql`${t.providerSubscriptionId} IS NOT NULL`),
    index("subscriptions_status_period_idx").on(t.status, t.periodEndsAt),
  ],
);
export const invoices = pgTable("invoices", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  providerInvoiceId: text("provider_invoice_id").unique(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_workspace_created_idx").on(t.workspaceId, t.createdAt)],
);
export const securityEvents = pgTable("security_events", {
  id: id(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  ipHash: text("ip_hash"),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: createdAt(),
});
export const featureFlags = pgTable(
  "feature_flags",
  {
    id: id(),
    key: text("key").notNull(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    configuration: jsonb("configuration").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("feature_flags_scope_unique").on(t.key, t.workspaceId)],
);
export const backgroundJobs = pgTable(
  "background_jobs",
  {
    id: id(),
    queue: text("queue").notNull(),
    type: text("type").notNull(),
    payload: jsonb("payload").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    deadLetteredAt: timestamp("dead_lettered_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("background_jobs_dedupe_unique").on(t.queue, t.dedupeKey),
    index("background_jobs_claim_idx").on(t.queue, t.status, t.nextAttemptAt),
    index("background_jobs_lease_idx").on(t.status, t.leaseExpiresAt),
    check("background_jobs_attempts_valid", sql`${t.attempts} >= 0 AND ${t.maxAttempts} > 0`),
  ],
);
export const dataExportRequests = pgTable("data_export_requests", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"),
  downloadUrl: text("download_url"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: createdAt(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});
export const deletionRequests = pgTable("deletion_requests", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),
  status: text("status").notNull().default("pending"),
  scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

// Phase 3 records are append-only where they represent observations, decisions, evidence, or versions.
export const integrationAnalyses = pgTable(
  "integration_analyses",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    formId: uuid("form_id").references(() => forms.id, { onDelete: "cascade" }),
    language: text("language").notNull(),
    sourceHash: text("source_hash").notNull(),
    parserVersion: text("parser_version").notNull(),
    supported: boolean("supported").notNull(),
    summary: jsonb("summary").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("integration_analyses_id_workspace_unique").on(t.id, t.workspaceId),
    foreignKey({
      name: "integration_analyses_form_workspace_fk",
      columns: [t.formId, t.workspaceId],
      foreignColumns: [forms.id, forms.workspaceId],
    }).onDelete("cascade"),
    index("integration_analyses_workspace_idx").on(t.workspaceId, t.createdAt),
  ],
);
export const integrationFindings = pgTable("integration_findings", {
  id: id(),
  analysisId: uuid("analysis_id")
    .notNull()
    .references(() => integrationAnalyses.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  severity: text("severity").notNull(),
  message: text("message").notNull(),
  evidence: jsonb("evidence").notNull().default({}),
  sourceRange: jsonb("source_range").notNull().default({}),
  createdAt: createdAt(),
});
export const repairPrompts = pgTable(
  "repair_prompts",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    formId: uuid("form_id").references(() => forms.id, { onDelete: "cascade" }),
    analysisId: uuid("analysis_id").references(() => integrationAnalyses.id, {
      onDelete: "set null",
    }),
    platform: text("platform").notNull(),
    version: text("version").notNull(),
    prompt: text("prompt").notNull(),
    provenance: jsonb("provenance").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "repair_prompts_form_workspace_fk",
      columns: [t.formId, t.workspaceId],
      foreignColumns: [forms.id, forms.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "repair_prompts_analysis_workspace_fk",
      columns: [t.analysisId, t.workspaceId],
      foreignColumns: [integrationAnalyses.id, integrationAnalyses.workspaceId],
    }).onDelete("restrict"),
  ],
);
export const scannerRuns = pgTable(
  "scanner_runs",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    formId: uuid("form_id").references(() => forms.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    status: text("status").notNull().default("pending"),
    browserStatus: text("browser_status").notNull().default("unavailable"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("scanner_runs_id_workspace_unique").on(t.id, t.workspaceId),
    foreignKey({
      name: "scanner_runs_form_workspace_fk",
      columns: [t.formId, t.workspaceId],
      foreignColumns: [forms.id, forms.workspaceId],
    }).onDelete("cascade"),
    index("scanner_runs_workspace_idx").on(t.workspaceId, t.createdAt),
  ],
);
export const scannerEvidence = pgTable(
  "scanner_evidence",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => scannerRuns.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    sequence: integer("sequence").notNull(),
    evidence: jsonb("evidence").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("scanner_evidence_sequence_unique").on(t.runId, t.sequence)],
);
export const schemaObservations = pgTable(
  "schema_observations",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    expectedVersionId: uuid("expected_version_id").references(() => formSchemaVersions.id, {
      onDelete: "set null",
    }),
    observedDefinition: jsonb("observed_definition").notNull(),
    changes: jsonb("changes").notNull(),
    fingerprint: text("fingerprint").notNull(),
    firstSubmissionId: uuid("first_submission_id").references(() => submissions.id, {
      onDelete: "set null",
    }),
    deploymentId: text("deployment_id"),
    status: text("status").notNull().default("open"),
    lockVersion: integer("lock_version").notNull().default(1),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("schema_observations_id_workspace_unique").on(t.id, t.workspaceId),
    foreignKey({
      name: "schema_observations_form_workspace_fk",
      columns: [t.formId, t.workspaceId],
      foreignColumns: [forms.id, forms.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "schema_observations_submission_workspace_fk",
      columns: [t.firstSubmissionId, t.workspaceId],
      foreignColumns: [submissions.id, submissions.workspaceId],
    }).onDelete("restrict"),
    index("schema_observations_form_idx").on(t.formId, t.createdAt),
    index("schema_observations_fingerprint_idx").on(t.formId, t.fingerprint),
  ],
);
export const schemaDriftDecisions = pgTable(
  "schema_drift_decisions",
  {
    id: id(),
    observationId: uuid("observation_id")
      .notNull()
      .references(() => schemaObservations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    expectedLockVersion: integer("expected_lock_version").notNull(),
    reason: text("reason"),
    createdVersionId: uuid("created_version_id").references(() => formSchemaVersions.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "schema_drift_decisions_observation_workspace_fk",
      columns: [t.observationId, t.workspaceId],
      foreignColumns: [schemaObservations.id, schemaObservations.workspaceId],
    }).onDelete("cascade"),
  ],
);
export const schemaMappings = pgTable(
  "schema_mappings",
  {
    id: id(),
    observationId: uuid("observation_id")
      .notNull()
      .references(() => schemaObservations.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    mapping: jsonb("mapping").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "schema_mappings_observation_workspace_fk",
      columns: [t.observationId, t.workspaceId],
      foreignColumns: [schemaObservations.id, schemaObservations.workspaceId],
    }).onDelete("cascade"),
  ],
);
export const driftIgnoreRules = pgTable(
  "drift_ignore_rules",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    fingerprint: text("fingerprint").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "drift_ignore_rules_form_workspace_fk",
      columns: [t.formId, t.workspaceId],
      foreignColumns: [forms.id, forms.workspaceId],
    }).onDelete("cascade"),
    uniqueIndex("drift_ignore_exact_unique").on(t.formId, t.fingerprint, t.expiresAt),
  ],
);
export const monitorSchedules = pgTable(
  "monitor_schedules",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    frequency: text("frequency").notNull(),
    active: boolean("active").notNull().default(true),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    failureThreshold: integer("failure_threshold").notNull().default(2),
    recoveryThreshold: integer("recovery_threshold").notNull().default(2),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("monitor_schedules_id_workspace_unique").on(t.id, t.workspaceId),
    foreignKey({
      name: "monitor_schedules_form_workspace_fk",
      columns: [t.formId, t.workspaceId],
      foreignColumns: [forms.id, forms.workspaceId],
    }).onDelete("cascade"),
    index("monitor_schedules_due_idx").on(t.active, t.nextRunAt),
  ],
);
export const monitorRuns = pgTable(
  "monitor_runs",
  {
    id: id(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => monitorSchedules.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    status: text("status").notNull(),
    synthetic: boolean("synthetic").notNull().default(true),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "monitor_runs_schedule_workspace_fk",
      columns: [t.scheduleId, t.workspaceId],
      foreignColumns: [monitorSchedules.id, monitorSchedules.workspaceId],
    }).onDelete("cascade"),
  ],
);
export const monitorRunEvidence = pgTable(
  "monitor_run_evidence",
  {
    id: id(),
    runId: uuid("run_id")
      .notNull()
      .references(() => monitorRuns.id, { onDelete: "cascade" }),
    step: text("step").notNull(),
    sequence: integer("sequence").notNull(),
    status: text("status").notNull(),
    evidence: jsonb("evidence").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("monitor_run_evidence_unique").on(t.runId, t.sequence)],
);
export const monitorIncidents = pgTable(
  "monitor_incidents",
  {
    id: id(),
    scheduleId: uuid("schedule_id")
      .notNull()
      .references(() => monitorSchedules.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("open"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "monitor_incidents_schedule_workspace_fk",
      columns: [t.scheduleId, t.workspaceId],
      foreignColumns: [monitorSchedules.id, monitorSchedules.workspaceId],
    }).onDelete("cascade"),
  ],
);
export const incidentEvents = pgTable("incident_events", {
  id: id(),
  incidentId: uuid("incident_id")
    .notNull()
    .references(() => monitorIncidents.id, { onDelete: "cascade" }),
  runId: uuid("run_id").references(() => monitorRuns.id, { onDelete: "set null" }),
  type: text("type").notNull(),
  evidence: jsonb("evidence").notNull().default({}),
  createdAt: createdAt(),
});
export const alertPolicies = pgTable("alert_policies", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  formId: uuid("form_id").references(() => forms.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  destinationEncrypted: text("destination_encrypted").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
export const alertDeliveries = pgTable("alert_deliveries", {
  id: id(),
  incidentId: uuid("incident_id")
    .notNull()
    .references(() => monitorIncidents.id, { onDelete: "cascade" }),
  policyId: uuid("policy_id")
    .notNull()
    .references(() => alertPolicies.id, { onDelete: "cascade" }),
  eventKey: text("event_key").notNull().unique(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  lastError: text("last_error"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
export const reliabilitySnapshots = pgTable(
  "reliability_snapshots",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    coverage: integer("coverage").notNull(),
    formulaVersion: text("formula_version").notNull(),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    check("reliability_score_range", sql`${t.score} BETWEEN 0 AND 100`),
    check("reliability_coverage_range", sql`${t.coverage} BETWEEN 0 AND 100`),
  ],
);
export const reliabilityComponents = pgTable(
  "reliability_components",
  {
    id: id(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => reliabilitySnapshots.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    state: text("state").notNull(),
    weight: integer("weight").notNull(),
    points: integer("points").notNull(),
    explanation: text("explanation").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("reliability_components_unique").on(t.snapshotId, t.key)],
);
export const reliabilityEvidence = pgTable("reliability_evidence", {
  id: id(),
  componentId: uuid("component_id")
    .notNull()
    .references(() => reliabilityComponents.id, { onDelete: "cascade" }),
  evidenceType: text("evidence_type").notNull(),
  evidenceId: text("evidence_id").notNull(),
  metadata: jsonb("metadata").notNull().default({}),
  createdAt: createdAt(),
});
export const routingRuleSets = pgTable(
  "routing_rule_sets",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    activeVersionId: uuid("active_version_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("routing_rule_sets_id_workspace_unique").on(t.id, t.workspaceId),
    foreignKey({
      name: "routing_rule_sets_form_workspace_fk",
      columns: [t.formId, t.workspaceId],
      foreignColumns: [forms.id, forms.workspaceId],
    }).onDelete("cascade"),
  ],
);
export const routingRuleVersions = pgTable(
  "routing_rule_versions",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    ruleSetId: uuid("rule_set_id")
      .notNull()
      .references(() => routingRuleSets.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    definition: jsonb("definition").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("routing_rule_versions_unique").on(t.ruleSetId, t.version),
    uniqueIndex("routing_rule_versions_id_workspace_unique").on(t.id, t.workspaceId),
    foreignKey({
      name: "routing_rule_versions_set_workspace_fk",
      columns: [t.ruleSetId, t.workspaceId],
      foreignColumns: [routingRuleSets.id, routingRuleSets.workspaceId],
    }).onDelete("cascade"),
  ],
);
export const routingDecisions = pgTable(
  "routing_decisions",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    ruleVersionId: uuid("rule_version_id")
      .notNull()
      .references(() => routingRuleVersions.id, { onDelete: "restrict" }),
    decision: jsonb("decision").notNull(),
    evidenceRedacted: jsonb("evidence_redacted").notNull(),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "routing_decisions_submission_workspace_fk",
      columns: [t.submissionId, t.workspaceId],
      foreignColumns: [submissions.id, submissions.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "routing_decisions_version_workspace_fk",
      columns: [t.ruleVersionId, t.workspaceId],
      foreignColumns: [routingRuleVersions.id, routingRuleVersions.workspaceId],
    }).onDelete("restrict"),
  ],
);
export const integrationDeliveries = pgTable(
  "integration_deliveries",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => integrationConnections.id, { onDelete: "cascade" }),
    submissionId: uuid("submission_id").references(() => submissions.id, { onDelete: "cascade" }),
    eventKey: text("event_key").notNull().unique(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    responseCode: integer("response_code"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "integration_deliveries_connection_workspace_fk",
      columns: [t.connectionId, t.workspaceId],
      foreignColumns: [integrationConnections.id, integrationConnections.workspaceId],
    }).onDelete("cascade"),
    foreignKey({
      name: "integration_deliveries_submission_workspace_fk",
      columns: [t.submissionId, t.workspaceId],
      foreignColumns: [submissions.id, submissions.workspaceId],
    }).onDelete("cascade"),
  ],
);
export const integrationHealth = pgTable("integration_health", {
  id: id(),
  connectionId: uuid("connection_id")
    .notNull()
    .references(() => integrationConnections.id, { onDelete: "cascade" }),
  state: text("state").notNull(),
  evidence: jsonb("evidence").notNull().default({}),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});
export const scopedTokens = pgTable(
  "scoped_tokens",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    prefix: text("prefix").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    scopes: jsonb("scopes").notNull().default([]),
    formGrants: jsonb("form_grants").notNull().default([]),
    rateLimitPerMinute: integer("rate_limit_per_minute").notNull().default(60),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("scoped_tokens_workspace_idx").on(t.workspaceId),
    check("scoped_tokens_rate_positive", sql`${t.rateLimitPerMinute} > 0`),
  ],
);
export const oauthTokens = pgTable("oauth_tokens", {
  id: id(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  connectionId: uuid("connection_id").references(() => integrationConnections.id, {
    onDelete: "cascade",
  }),
  provider: text("provider").notNull(),
  accessEnvelope: jsonb("access_envelope").notNull(),
  refreshEnvelope: jsonb("refresh_envelope"),
  scopes: jsonb("scopes").notNull().default([]),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dimensions: jsonb("dimensions").notNull().default({}),
    metrics: jsonb("metrics").notNull().default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "analytics_events_form_workspace_fk",
      columns: [t.formId, t.workspaceId],
      foreignColumns: [forms.id, forms.workspaceId],
    }).onDelete("cascade"),
    index("analytics_events_form_time_idx").on(t.formId, t.occurredAt),
  ],
);
export const analyticsAggregates = pgTable(
  "analytics_aggregates",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    formId: uuid("form_id")
      .notNull()
      .references(() => forms.id, { onDelete: "cascade" }),
    bucket: timestamp("bucket", { withTimezone: true }).notNull(),
    interval: text("interval").notNull(),
    name: text("name").notNull(),
    dimensions: jsonb("dimensions").notNull().default({}),
    count: integer("count").notNull().default(0),
    metrics: jsonb("metrics").notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "analytics_aggregates_form_workspace_fk",
      columns: [t.formId, t.workspaceId],
      foreignColumns: [forms.id, forms.workspaceId],
    }).onDelete("cascade"),
    uniqueIndex("analytics_aggregates_unique").on(t.formId, t.bucket, t.interval, t.name),
  ],
);
export const analyticsConsent = pgTable(
  "analytics_consent",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    formId: uuid("form_id").references(() => forms.id, { onDelete: "cascade" }),
    mode: text("mode").notNull().default("essential"),
    version: integer("version").notNull().default(1),
    updatedAt: updatedAt(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "analytics_consent_form_workspace_fk",
      columns: [t.formId, t.workspaceId],
      foreignColumns: [forms.id, forms.workspaceId],
    }).onDelete("cascade"),
    uniqueIndex("analytics_consent_scope_unique").on(t.workspaceId, t.formId),
  ],
);
export const agencyAccounts = pgTable("agency_accounts", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
export const agencyMembers = pgTable(
  "agency_members",
  {
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencyAccounts.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.agencyId, t.userId] })],
);
export const agencyClientGrants = pgTable(
  "agency_client_grants",
  {
    id: id(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencyAccounts.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    grants: jsonb("grants").notNull().default([]),
    viewerUserIds: jsonb("viewer_user_ids").notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("agency_client_grants_unique").on(t.agencyId, t.workspaceId)],
);
export const agencyTemplates = pgTable(
  "agency_templates",
  {
    id: id(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencyAccounts.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    name: text("name").notNull(),
    version: integer("version").notNull(),
    definition: jsonb("definition").notNull(),
    usageNotes: text("usage_notes").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("agency_templates_version_unique").on(t.agencyId, t.name, t.version)],
);
export const agencyBranding = pgTable("agency_branding", {
  agencyId: uuid("agency_id")
    .primaryKey()
    .references(() => agencyAccounts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color"),
  customDomain: text("custom_domain"),
  updatedAt: updatedAt(),
  createdAt: createdAt(),
});
export const reportRequests = pgTable(
  "report_requests",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    agencyId: uuid("agency_id").references(() => agencyAccounts.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    format: text("format").notNull(),
    status: text("status").notNull().default("pending"),
    parameters: jsonb("parameters").notNull().default({}),
    requestedByUserId: uuid("requested_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("report_requests_id_workspace_unique").on(t.id, t.workspaceId)],
);
export const reportArtifacts = pgTable(
  "report_artifacts",
  {
    id: id(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => reportRequests.id, { onDelete: "cascade" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    format: text("format").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    checksumSha256: text("checksum_sha256").notNull(),
    manifestChecksumSha256: text("manifest_checksum_sha256").notNull(),
    byteSize: integer("byte_size").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("report_artifacts_id_workspace_unique").on(t.id, t.workspaceId),
    foreignKey({
      name: "report_artifacts_request_workspace_fk",
      columns: [t.requestId, t.workspaceId],
      foreignColumns: [reportRequests.id, reportRequests.workspaceId],
    }).onDelete("cascade"),
  ],
);
export const reportEvidenceManifests = pgTable(
  "report_evidence_manifests",
  {
    id: id(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => reportArtifacts.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    evidenceIds: jsonb("evidence_ids").notNull().default([]),
    links: jsonb("links").notNull().default([]),
    checksumSha256: text("checksum_sha256").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("report_evidence_manifest_unique").on(t.artifactId, t.version)],
);

// Phase 4 control-plane records. Evidence, provider events, decisions, and audit records are append-only.
export const stripeEvents = pgTable(
  "stripe_events",
  {
    id: id(),
    providerEventId: text("provider_event_id").notNull(),
    eventType: text("event_type").notNull(),
    payloadHash: text("payload_hash").notNull(),
    providerCreatedAt: timestamp("provider_created_at", { withTimezone: true }).notNull(),
    livemode: boolean("livemode").notNull(),
    status: text("status").notNull().default("received"),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    errorCode: text("error_code"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("stripe_events_provider_id_unique").on(t.providerEventId),
    index("stripe_events_status_created_idx").on(t.status, t.createdAt),
    index("stripe_events_workspace_created_idx").on(t.workspaceId, t.createdAt),
  ],
);

export const entitlementOverrides = pgTable(
  "entitlement_overrides",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    limitKey: text("limit_key"),
    featureKey: text("feature_key"),
    value: jsonb("value").notNull(),
    reason: text("reason").notNull(),
    ticket: text("ticket").notNull(),
    actorAdminId: uuid("actor_admin_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("entitlement_overrides_workspace_active_idx").on(t.workspaceId, t.expiresAt, t.revokedAt),
    check(
      "entitlement_overrides_one_target",
      sql`(${t.limitKey} IS NULL) <> (${t.featureKey} IS NULL)`,
    ),
    check("entitlement_overrides_valid_window", sql`${t.expiresAt} > ${t.startsAt}`),
  ],
);

export const usageReservations = pgTable(
  "usage_reservations",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    quantity: integer("quantity").notNull(),
    bucketMonth: timestamp("bucket_month", { withTimezone: true }).notNull(),
    state: text("state").notNull().default("reserved"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("usage_reservations_source_unique").on(
      t.workspaceId,
      t.metric,
      t.sourceType,
      t.sourceId,
    ),
    index("usage_reservations_pending_idx").on(t.state, t.expiresAt),
    check("usage_reservations_quantity_positive", sql`${t.quantity} > 0`),
  ],
);

export const workspaceRestrictions = pgTable(
  "workspace_restrictions",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    reasonCode: text("reason_code").notNull(),
    customerMessage: text("customer_message").notNull(),
    caseId: uuid("case_id"),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    liftedAt: timestamp("lifted_at", { withTimezone: true }),
    createdByAdminId: uuid("created_by_admin_id"),
    createdAt: createdAt(),
  },
  (t) => [
    index("workspace_restrictions_active_idx").on(t.workspaceId, t.scope, t.expiresAt, t.liftedAt),
    check("workspace_restrictions_temporary", sql`${t.expiresAt} > ${t.startsAt}`),
  ],
);

export const abuseCases = pgTable(
  "abuse_cases",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    status: text("status").notNull().default("open"),
    severity: text("severity").notNull(),
    reasonCode: text("reason_code").notNull(),
    reviewDueAt: timestamp("review_due_at", { withTimezone: true }).notNull(),
    assignedAdminId: uuid("assigned_admin_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [index("abuse_cases_pending_review_idx").on(t.status, t.reviewDueAt, t.createdAt)],
);
export const abuseEvidence = pgTable(
  "abuse_evidence",
  {
    id: id(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => abuseCases.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    sourceId: text("source_id"),
    summary: text("summary").notNull(),
    evidence: jsonb("evidence").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("abuse_evidence_case_created_idx").on(t.caseId, t.createdAt)],
);
export const abuseDecisions = pgTable(
  "abuse_decisions",
  {
    id: id(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => abuseCases.id, { onDelete: "restrict" }),
    decision: text("decision").notNull(),
    reason: text("reason").notNull(),
    actorAdminId: uuid("actor_admin_id").notNull(),
    ticket: text("ticket").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("abuse_decisions_case_created_idx").on(t.caseId, t.createdAt)],
);
export const abuseAppeals = pgTable(
  "abuse_appeals",
  {
    id: id(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => abuseCases.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    statement: text("statement").notNull(),
    status: text("status").notNull().default("pending"),
    reviewDueAt: timestamp("review_due_at", { withTimezone: true }).notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("abuse_appeals_pending_idx").on(t.status, t.reviewDueAt)],
);

export const platformAdmins = pgTable(
  "platform_admins",
  {
    id: id(),
    externalSubject: text("external_subject").notNull().unique(),
    role: text("role").notNull(),
    active: boolean("active").notNull().default(true),
    mfaVerifiedAt: timestamp("mfa_verified_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("platform_admins_active_idx").on(t.active, t.role)],
);
export const platformAdminSessions = pgTable(
  "platform_admin_sessions",
  {
    id: id(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => platformAdmins.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    idpSessionId: text("idp_session_id").notNull(),
    mfa: boolean("mfa").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("platform_admin_sessions_active_idx").on(t.adminId, t.expiresAt, t.revokedAt)],
);
export const platformAdminAudit = pgTable(
  "platform_admin_audit",
  {
    id: id(),
    adminId: uuid("admin_id")
      .notNull()
      .references(() => platformAdmins.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    reason: text("reason").notNull(),
    ticket: text("ticket").notNull(),
    correlationId: text("correlation_id").notNull(),
    suspicious: boolean("suspicious").notNull().default(false),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [
    index("platform_admin_audit_created_idx").on(t.createdAt),
    index("platform_admin_audit_suspicious_idx").on(t.suspicious, t.createdAt),
  ],
);

export const legalHolds = pgTable(
  "legal_holds",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    scope: text("scope").notNull(),
    reason: text("reason").notNull(),
    ticket: text("ticket").notNull(),
    createdByAdminId: uuid("created_by_admin_id").notNull(),
    releasedByAdminId: uuid("released_by_admin_id"),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("legal_holds_active_idx").on(t.workspaceId, t.releasedAt)],
);
export const privacyRequests = pgTable(
  "privacy_requests",
  {
    id: id(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "restrict" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("pending_verification"),
    verificationRef: text("verification_ref"),
    graceEndsAt: timestamp("grace_ends_at", { withTimezone: true }),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
    backupDeletionDueAt: timestamp("backup_deletion_due_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("privacy_requests_pending_idx").on(t.status, t.createdAt)],
);
export const privacyJobs = pgTable(
  "privacy_jobs",
  {
    id: id(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => privacyRequests.id, { onDelete: "restrict" }),
    step: text("step").notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    evidence: jsonb("evidence").notNull().default({}),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("privacy_jobs_pending_idx").on(t.status, t.nextAttemptAt)],
);
export const privacyArtifacts = pgTable(
  "privacy_artifacts",
  {
    id: id(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => privacyRequests.id, { onDelete: "restrict" }),
    storageKey: text("storage_key").notNull().unique(),
    checksumSha256: text("checksum_sha256").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("privacy_artifacts_expiry_idx").on(t.expiresAt, t.deletedAt)],
);
export const retentionJobs = pgTable(
  "retention_jobs",
  {
    id: id(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "restrict" }),
    retentionClass: text("retention_class").notNull(),
    cutoffAt: timestamp("cutoff_at", { withTimezone: true }).notNull(),
    dedupeKey: text("dedupe_key").notNull().unique(),
    status: text("status").notNull().default("pending"),
    evidence: jsonb("evidence").notNull().default({}),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("retention_jobs_pending_idx").on(t.status, t.cutoffAt)],
);
export const policyAcceptances = pgTable(
  "policy_acceptances",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "restrict" }),
    policy: text("policy").notNull(),
    version: text("version").notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
    correlationId: text("correlation_id").notNull(),
  },
  (t) => [uniqueIndex("policy_acceptances_version_unique").on(t.userId, t.policy, t.version)],
);
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    scopeHash: text("scope_hash").notNull(),
    bucketStart: timestamp("bucket_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.scopeHash, t.bucketStart] }),
    index("rate_limit_buckets_expiry_idx").on(t.expiresAt),
    check("rate_limit_buckets_nonnegative", sql`${t.count} >= 0`),
  ],
);
