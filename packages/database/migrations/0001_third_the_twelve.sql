CREATE TABLE "delivery_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"submission_id" uuid NOT NULL,
	"destination_type" text NOT NULL,
	"destination" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"terminal" boolean DEFAULT false NOT NULL,
	"last_error" text,
	"response_code" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_events_attempts_valid" CHECK ("delivery_events"."attempts" >= 0 AND "delivery_events"."max_attempts" > 0)
);
--> statement-breakpoint
CREATE TABLE "form_captcha_configurations" (
	"form_id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"site_key" text NOT NULL,
	"secret_encrypted" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "form_captcha_provider_valid" CHECK ("form_captcha_configurations"."provider" IN ('turnstile', 'development'))
);
--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "status" SET DEFAULT 'new';--> statement-breakpoint
ALTER TABLE "autoresponders" ADD COLUMN "recipient_field" text DEFAULT 'email' NOT NULL;--> statement-breakpoint
ALTER TABLE "autoresponders" ADD COLUMN "delay_seconds" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "autoresponders" ADD COLUMN "suppress_spam" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "autoresponders" ADD COLUMN "suppress_test" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN "dedupe_key" text;--> statement-breakpoint
UPDATE "background_jobs" SET "dedupe_key" = 'legacy:' || "id"::text WHERE "dedupe_key" IS NULL;--> statement-breakpoint
ALTER TABLE "background_jobs" ALTER COLUMN "dedupe_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN "max_attempts" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN "lease_owner" text;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "background_jobs" ADD COLUMN "dead_lettered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "allowed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "allow_no_origin" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "schema_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "max_body_bytes" integer DEFAULT 1048576 NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "max_fields" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "max_files" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "max_file_bytes" integer DEFAULT 5242880 NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "max_total_file_bytes" integer DEFAULT 10485760 NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "idempotency_window_seconds" integer DEFAULT 86400 NOT NULL;--> statement-breakpoint
ALTER TABLE "forms" ADD COLUMN "duplicate_window_seconds" integer DEFAULT 3600 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "event_key" text;--> statement-breakpoint
UPDATE "notification_deliveries" SET "event_key" = 'legacy:notification:' || "id"::text WHERE "event_key" IS NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ALTER COLUMN "event_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
UPDATE "notification_deliveries" SET "idempotency_key" = "event_key" WHERE "idempotency_key" IS NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "max_attempts" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_deliveries" ADD COLUMN "terminal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "submission_files" ADD COLUMN "field_name" text DEFAULT 'file' NOT NULL;--> statement-breakpoint
ALTER TABLE "submission_files" ADD COLUMN "detected_type" text;--> statement-breakpoint
ALTER TABLE "submission_files" ADD COLUMN "checksum_sha256" text;--> statement-breakpoint
UPDATE "submission_files" SET "checksum_sha256" = encode(digest("storage_key", 'sha256'), 'hex') WHERE "checksum_sha256" IS NULL;--> statement-breakpoint
ALTER TABLE "submission_files" ALTER COLUMN "checksum_sha256" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "submission_files" ADD COLUMN "quarantine_state" text DEFAULT 'quarantined' NOT NULL;--> statement-breakpoint
ALTER TABLE "submission_files" ADD COLUMN "scan_state" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "request_id" text;--> statement-breakpoint
UPDATE "submissions" SET "request_id" = gen_random_uuid()::text WHERE "request_id" IS NULL;--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "request_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
UPDATE "submissions" s SET "workspace_id" = f."workspace_id" FROM "forms" f WHERE s."form_id" = f."id" AND s."workspace_id" IS NULL;--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "schema_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "content_type" text DEFAULT 'application/json' NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "payload_bytes" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "origin" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "referrer" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "utm" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "spam_status" text DEFAULT 'allowed' NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "spam_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "spam_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "test" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "processing_state" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "notification_state" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "webhook_state" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "request_fingerprint" text;--> statement-breakpoint
UPDATE "submissions" SET "request_fingerprint" = encode(digest("payload"::text, 'sha256'), 'hex') WHERE "request_fingerprint" IS NULL;--> statement-breakpoint
ALTER TABLE "submissions" ALTER COLUMN "request_fingerprint" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "probable_duplicate" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "duplicate_of_id" uuid;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "retention_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "submissions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "event_key" text;--> statement-breakpoint
UPDATE "webhook_deliveries" SET "event_key" = 'legacy:webhook:' || "id"::text WHERE "event_key" IS NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "event_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "event_id" text;--> statement-breakpoint
UPDATE "webhook_deliveries" SET "event_id" = gen_random_uuid()::text WHERE "event_id" IS NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "event_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
UPDATE "webhook_deliveries" SET "idempotency_key" = "event_key" WHERE "idempotency_key" IS NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ALTER COLUMN "idempotency_key" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "max_attempts" integer DEFAULT 5 NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "terminal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "form_id" uuid;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "previous_secret_encrypted" text;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "previous_secret_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "subscribed_events" jsonb DEFAULT '["submission.accepted"]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "consecutive_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD COLUMN "disabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "delivery_events" ADD CONSTRAINT "delivery_events_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_captcha_configurations" ADD CONSTRAINT "form_captcha_configurations_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_events_event_key_unique" ON "delivery_events" USING btree ("event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_events_idempotency_unique" ON "delivery_events" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "delivery_events_retry_idx" ON "delivery_events" USING btree ("status","next_attempt_at");--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_form_id_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."forms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "background_jobs_dedupe_unique" ON "background_jobs" USING btree ("queue","dedupe_key");--> statement-breakpoint
CREATE INDEX "background_jobs_claim_idx" ON "background_jobs" USING btree ("queue","status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "background_jobs_lease_idx" ON "background_jobs" USING btree ("status","lease_expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_deliveries_event_key_unique" ON "notification_deliveries" USING btree ("event_key");--> statement-breakpoint
CREATE INDEX "notification_deliveries_retry_idx" ON "notification_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_files_storage_key_unique" ON "submission_files" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "submission_files_submission_idx" ON "submission_files" USING btree ("submission_id");--> statement-breakpoint
CREATE INDEX "submissions_workspace_created_idx" ON "submissions" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "submissions_fingerprint_idx" ON "submissions" USING btree ("form_id","request_fingerprint","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_request_id_unique" ON "submissions" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_event_key_unique" ON "webhook_deliveries" USING btree ("event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_event_id_unique" ON "webhook_deliveries" USING btree ("event_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_retry_idx" ON "webhook_deliveries" USING btree ("status","next_attempt_at");--> statement-breakpoint
ALTER TABLE "background_jobs" ADD CONSTRAINT "background_jobs_attempts_valid" CHECK ("background_jobs"."attempts" >= 0 AND "background_jobs"."max_attempts" > 0);--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_max_body_positive" CHECK ("forms"."max_body_bytes" > 0);--> statement-breakpoint
ALTER TABLE "forms" ADD CONSTRAINT "forms_file_limits_nonnegative" CHECK ("forms"."max_files" >= 0 AND "forms"."max_file_bytes" > 0 AND "forms"."max_total_file_bytes" > 0);--> statement-breakpoint
ALTER TABLE "submission_files" ADD CONSTRAINT "submission_files_size_nonnegative" CHECK ("submission_files"."byte_size" >= 0);--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_payload_bytes_nonnegative" CHECK ("submissions"."payload_bytes" >= 0);--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_spam_score_range" CHECK ("submissions"."spam_score" BETWEEN 0 AND 100);