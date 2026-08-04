import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const migrationUrl = new URL("../migrations/0007_slim_princess_powerful.sql", import.meta.url);

describe("Phase 4 additive migration", () => {
  it("extends plans in place before adding control-plane records", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql.indexOf('ALTER TYPE "public"."plan_id" ADD VALUE \'starter\'')).toBeLessThan(
      sql.indexOf('CREATE TABLE "stripe_events"'),
    );
    expect(sql).not.toMatch(/DROP TABLE|DROP TYPE|DROP COLUMN/);
  });

  it("contains provider, dedupe, keyset, and pending-work indexes", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    for (const index of [
      "stripe_events_provider_id_unique",
      "usage_events_source_unique",
      "usage_reservations_source_unique",
      "submissions_workspace_status_created_idx",
      "submissions_workspace_form_status_created_idx",
      "privacy_jobs_pending_idx",
      "abuse_cases_pending_review_idx",
      "platform_admin_audit_suspicious_idx",
    ])
      expect(sql, index).toContain(index);
  });

  it("backfills usage dedupe and monthly buckets before non-null constraints", async () => {
    const sql = await readFile(migrationUrl, "utf8");
    expect(sql).toContain('SET "source_id" = "id"::text');
    expect(sql).toContain("date_trunc('month', \"occurred_at\")");
  });
});
