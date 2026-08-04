ALTER TYPE "public"."plan_id" ADD VALUE 'starter' BEFORE 'pro';--> statement-breakpoint
ALTER TYPE "public"."plan_id" ADD VALUE 'agency';--> statement-breakpoint
CREATE TABLE "abuse_appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"statement" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"review_due_at" timestamp with time zone NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "abuse_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"severity" text NOT NULL,
	"reason_code" text NOT NULL,
	"review_due_at" timestamp with time zone NOT NULL,
	"assigned_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "abuse_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"decision" text NOT NULL,
	"reason" text NOT NULL,
	"actor_admin_id" uuid NOT NULL,
	"ticket" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "abuse_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"source_id" text,
	"summary" text NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entitlement_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"limit_key" text,
	"feature_key" text,
	"value" jsonb NOT NULL,
	"reason" text NOT NULL,
	"ticket" text NOT NULL,
	"actor_admin_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entitlement_overrides_one_target" CHECK (("entitlement_overrides"."limit_key" IS NULL) <> ("entitlement_overrides"."feature_key" IS NULL)),
	CONSTRAINT "entitlement_overrides_valid_window" CHECK ("entitlement_overrides"."expires_at" > "entitlement_overrides"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "legal_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"reason" text NOT NULL,
	"ticket" text NOT NULL,
	"created_by_admin_id" uuid NOT NULL,
	"released_by_admin_id" uuid,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admin_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"reason" text NOT NULL,
	"ticket" text NOT NULL,
	"correlation_id" text NOT NULL,
	"suspicious" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"idp_session_id" text NOT NULL,
	"mfa" boolean NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admin_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_subject" text NOT NULL,
	"role" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"mfa_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admins_external_subject_unique" UNIQUE("external_subject")
);
--> statement-breakpoint
CREATE TABLE "policy_acceptances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"policy" text NOT NULL,
	"version" text NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"correlation_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"checksum_sha256" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_artifacts_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "privacy_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"step" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "privacy_jobs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "privacy_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"user_id" uuid,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending_verification' NOT NULL,
	"verification_ref" text,
	"grace_ends_at" timestamp with time zone,
	"cancel_requested_at" timestamp with time zone,
	"backup_deletion_due_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_buckets" (
	"scope_hash" text NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limit_buckets_scope_hash_bucket_start_pk" PRIMARY KEY("scope_hash","bucket_start"),
	CONSTRAINT "rate_limit_buckets_nonnegative" CHECK ("rate_limit_buckets"."count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "retention_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"retention_class" text NOT NULL,
	"cutoff_at" timestamp with time zone NOT NULL,
	"dedupe_key" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"evidence" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "retention_jobs_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
CREATE TABLE "stripe_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_hash" text NOT NULL,
	"provider_created_at" timestamp with time zone NOT NULL,
	"livemode" boolean NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"workspace_id" uuid,
	"error_code" text,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"workspace_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"bucket_month" timestamp with time zone NOT NULL,
	"committed" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_counters_workspace_id_metric_bucket_month_pk" PRIMARY KEY("workspace_id","metric","bucket_month"),
	CONSTRAINT "usage_counters_nonnegative" CHECK ("usage_counters"."committed" >= 0 AND "usage_counters"."reserved" >= 0)
);
--> statement-breakpoint
CREATE TABLE "usage_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"metric" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"quantity" integer NOT NULL,
	"bucket_month" timestamp with time zone NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_reservations_quantity_positive" CHECK ("usage_reservations"."quantity" > 0)
);
--> statement-breakpoint
CREATE TABLE "workspace_restrictions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"reason_code" text NOT NULL,
	"customer_message" text NOT NULL,
	"case_id" uuid,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"lifted_at" timestamp with time zone,
	"created_by_admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_restrictions_temporary" CHECK ("workspace_restrictions"."expires_at" > "workspace_restrictions"."starts_at")
);
--> statement-breakpoint
DROP INDEX "submissions_form_created_idx";--> statement-breakpoint
DROP INDEX "submissions_workspace_created_idx";--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "scopes" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "form_grants" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "rotated_from_id" uuid;--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "created_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider" text DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider_price_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancel_at_period_end" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "period_starts_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "grace_ends_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_event_created_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "source_type" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "source_id" text;--> statement-breakpoint
UPDATE "usage_events" SET "source_id" = "id"::text WHERE "source_id" IS NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ALTER COLUMN "source_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ALTER COLUMN "source_id" SET DEFAULT 'legacy';--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "bucket_month" timestamp with time zone;--> statement-breakpoint
UPDATE "usage_events" SET "bucket_month" = date_trunc('month', "occurred_at") WHERE "bucket_month" IS NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ALTER COLUMN "bucket_month" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ALTER COLUMN "bucket_month" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "correlation_id" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "lifecycle_state" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "suspended_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "deletion_scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "abuse_appeals" ADD CONSTRAINT "abuse_appeals_case_id_abuse_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."abuse_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abuse_appeals" ADD CONSTRAINT "abuse_appeals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abuse_cases" ADD CONSTRAINT "abuse_cases_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abuse_decisions" ADD CONSTRAINT "abuse_decisions_case_id_abuse_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."abuse_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "abuse_evidence" ADD CONSTRAINT "abuse_evidence_case_id_abuse_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."abuse_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entitlement_overrides" ADD CONSTRAINT "entitlement_overrides_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admin_audit" ADD CONSTRAINT "platform_admin_audit_admin_id_platform_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_admin_sessions" ADD CONSTRAINT "platform_admin_sessions_admin_id_platform_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_acceptances" ADD CONSTRAINT "policy_acceptances_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_acceptances" ADD CONSTRAINT "policy_acceptances_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_artifacts" ADD CONSTRAINT "privacy_artifacts_request_id_privacy_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."privacy_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_jobs" ADD CONSTRAINT "privacy_jobs_request_id_privacy_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."privacy_requests"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_requests" ADD CONSTRAINT "privacy_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retention_jobs" ADD CONSTRAINT "retention_jobs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stripe_events" ADD CONSTRAINT "stripe_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_restrictions" ADD CONSTRAINT "workspace_restrictions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "abuse_appeals_pending_idx" ON "abuse_appeals" USING btree ("status","review_due_at");--> statement-breakpoint
CREATE INDEX "abuse_cases_pending_review_idx" ON "abuse_cases" USING btree ("status","review_due_at","created_at");--> statement-breakpoint
CREATE INDEX "abuse_decisions_case_created_idx" ON "abuse_decisions" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "abuse_evidence_case_created_idx" ON "abuse_evidence" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "entitlement_overrides_workspace_active_idx" ON "entitlement_overrides" USING btree ("workspace_id","expires_at","revoked_at");--> statement-breakpoint
CREATE INDEX "legal_holds_active_idx" ON "legal_holds" USING btree ("workspace_id","released_at");--> statement-breakpoint
CREATE INDEX "platform_admin_audit_created_idx" ON "platform_admin_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "platform_admin_audit_suspicious_idx" ON "platform_admin_audit" USING btree ("suspicious","created_at");--> statement-breakpoint
CREATE INDEX "platform_admin_sessions_active_idx" ON "platform_admin_sessions" USING btree ("admin_id","expires_at","revoked_at");--> statement-breakpoint
CREATE INDEX "platform_admins_active_idx" ON "platform_admins" USING btree ("active","role");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_acceptances_version_unique" ON "policy_acceptances" USING btree ("user_id","policy","version");--> statement-breakpoint
CREATE INDEX "privacy_artifacts_expiry_idx" ON "privacy_artifacts" USING btree ("expires_at","deleted_at");--> statement-breakpoint
CREATE INDEX "privacy_jobs_pending_idx" ON "privacy_jobs" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "privacy_requests_pending_idx" ON "privacy_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "rate_limit_buckets_expiry_idx" ON "rate_limit_buckets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "retention_jobs_pending_idx" ON "retention_jobs" USING btree ("status","cutoff_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stripe_events_provider_id_unique" ON "stripe_events" USING btree ("provider_event_id");--> statement-breakpoint
CREATE INDEX "stripe_events_status_created_idx" ON "stripe_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "stripe_events_workspace_created_idx" ON "stripe_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_reservations_source_unique" ON "usage_reservations" USING btree ("workspace_id","metric","source_type","source_id");--> statement-breakpoint
CREATE INDEX "usage_reservations_pending_idx" ON "usage_reservations" USING btree ("state","expires_at");--> statement-breakpoint
CREATE INDEX "workspace_restrictions_active_idx" ON "workspace_restrictions" USING btree ("workspace_id","scope","expires_at","lifted_at");--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_rotated_from_id_api_keys_id_fk" FOREIGN KEY ("rotated_from_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_workspace_active_idx" ON "api_keys" USING btree ("workspace_id","revoked_at","expires_at");--> statement-breakpoint
CREATE INDEX "api_keys_prefix_idx" ON "api_keys" USING btree ("prefix");--> statement-breakpoint
CREATE INDEX "submissions_workspace_status_created_idx" ON "submissions" USING btree ("workspace_id","status","created_at","id");--> statement-breakpoint
CREATE INDEX "submissions_workspace_form_status_created_idx" ON "submissions" USING btree ("workspace_id","form_id","status","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_customer_unique" ON "subscriptions" USING btree ("provider","provider_customer_id") WHERE "subscriptions"."provider_customer_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_subscription_unique" ON "subscriptions" USING btree ("provider","provider_subscription_id") WHERE "subscriptions"."provider_subscription_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "subscriptions_status_period_idx" ON "subscriptions" USING btree ("status","period_ends_at");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_events_source_unique" ON "usage_events" USING btree ("workspace_id","metric","source_type","source_id");--> statement-breakpoint
CREATE INDEX "usage_events_workspace_bucket_idx" ON "usage_events" USING btree ("workspace_id","metric","bucket_month");--> statement-breakpoint
CREATE INDEX "workspaces_lifecycle_idx" ON "workspaces" USING btree ("lifecycle_state","updated_at");--> statement-breakpoint
CREATE INDEX "submissions_form_created_idx" ON "submissions" USING btree ("form_id","created_at","id");--> statement-breakpoint
CREATE INDEX "submissions_workspace_created_idx" ON "submissions" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_quantity_positive" CHECK ("usage_events"."quantity" > 0);--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_lifecycle_valid" CHECK ("workspaces"."lifecycle_state" IN ('active', 'restricted', 'suspended', 'deleting', 'deleted'));