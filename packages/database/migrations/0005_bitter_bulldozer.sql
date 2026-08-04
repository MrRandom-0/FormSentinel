ALTER TABLE "report_artifacts" ADD COLUMN "manifest_checksum_sha256" text;--> statement-breakpoint
UPDATE "report_artifacts" SET "manifest_checksum_sha256" = "checksum_sha256" WHERE "manifest_checksum_sha256" IS NULL;--> statement-breakpoint
ALTER TABLE "report_artifacts" ALTER COLUMN "manifest_checksum_sha256" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "routing_rule_versions" ADD COLUMN "workspace_id" uuid;--> statement-breakpoint
UPDATE "routing_rule_versions" AS v SET "workspace_id" = s."workspace_id" FROM "routing_rule_sets" AS s WHERE v."rule_set_id" = s."id" AND v."workspace_id" IS NULL;--> statement-breakpoint
ALTER TABLE "routing_rule_versions" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "forms_id_workspace_unique" ON "forms" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_id_workspace_unique" ON "submissions" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_analyses_id_workspace_unique" ON "integration_analyses" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_id_workspace_unique" ON "integration_connections" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_artifacts_id_workspace_unique" ON "report_artifacts" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "report_requests_id_workspace_unique" ON "report_requests" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "routing_rule_sets_id_workspace_unique" ON "routing_rule_sets" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "routing_rule_versions_id_workspace_unique" ON "routing_rule_versions" USING btree ("id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scanner_runs_id_workspace_unique" ON "scanner_runs" USING btree ("id","workspace_id");--> statement-breakpoint
ALTER TABLE "analytics_aggregates" ADD CONSTRAINT "analytics_aggregates_form_workspace_fk" FOREIGN KEY ("form_id","workspace_id") REFERENCES "public"."forms"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_consent" ADD CONSTRAINT "analytics_consent_form_workspace_fk" FOREIGN KEY ("form_id","workspace_id") REFERENCES "public"."forms"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_form_workspace_fk" FOREIGN KEY ("form_id","workspace_id") REFERENCES "public"."forms"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_analyses" ADD CONSTRAINT "integration_analyses_form_workspace_fk" FOREIGN KEY ("form_id","workspace_id") REFERENCES "public"."forms"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD CONSTRAINT "integration_deliveries_connection_workspace_fk" FOREIGN KEY ("connection_id","workspace_id") REFERENCES "public"."integration_connections"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_deliveries" ADD CONSTRAINT "integration_deliveries_submission_workspace_fk" FOREIGN KEY ("submission_id","workspace_id") REFERENCES "public"."submissions"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_prompts" ADD CONSTRAINT "repair_prompts_form_workspace_fk" FOREIGN KEY ("form_id","workspace_id") REFERENCES "public"."forms"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_prompts" ADD CONSTRAINT "repair_prompts_analysis_workspace_fk" FOREIGN KEY ("analysis_id","workspace_id") REFERENCES "public"."integration_analyses"("id","workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_artifacts" ADD CONSTRAINT "report_artifacts_request_workspace_fk" FOREIGN KEY ("request_id","workspace_id") REFERENCES "public"."report_requests"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_decisions" ADD CONSTRAINT "routing_decisions_submission_workspace_fk" FOREIGN KEY ("submission_id","workspace_id") REFERENCES "public"."submissions"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_decisions" ADD CONSTRAINT "routing_decisions_version_workspace_fk" FOREIGN KEY ("rule_version_id","workspace_id") REFERENCES "public"."routing_rule_versions"("id","workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rule_sets" ADD CONSTRAINT "routing_rule_sets_form_workspace_fk" FOREIGN KEY ("form_id","workspace_id") REFERENCES "public"."forms"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rule_versions" ADD CONSTRAINT "routing_rule_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "routing_rule_versions" ADD CONSTRAINT "routing_rule_versions_set_workspace_fk" FOREIGN KEY ("rule_set_id","workspace_id") REFERENCES "public"."routing_rule_sets"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scanner_runs" ADD CONSTRAINT "scanner_runs_form_workspace_fk" FOREIGN KEY ("form_id","workspace_id") REFERENCES "public"."forms"("id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_form_workspace_fk" FOREIGN KEY ("form_id","workspace_id") REFERENCES "public"."forms"("id","workspace_id") ON DELETE cascade ON UPDATE no action;
