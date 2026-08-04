DROP INDEX "submissions_request_id_unique";--> statement-breakpoint
CREATE INDEX "submissions_request_id_idx" ON "submissions" USING btree ("request_id");