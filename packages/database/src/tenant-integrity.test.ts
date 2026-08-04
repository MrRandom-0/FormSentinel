import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Phase 3 tenant integrity migration", () => {
  it("database-enforces workspace ownership for Phase 3 parent associations", async () => {
    const migrations = `${await readFile(new URL("../migrations/0005_bitter_bulldozer.sql", import.meta.url), "utf8")}\n${await readFile(new URL("../migrations/0006_deep_william_stryker.sql", import.meta.url), "utf8")}`;
    for (const constraint of [
      "scanner_runs_form_workspace_fk",
      "analytics_events_form_workspace_fk",
      "routing_decisions_submission_workspace_fk",
      "routing_decisions_version_workspace_fk",
      "integration_deliveries_connection_workspace_fk",
      "report_artifacts_request_workspace_fk",
      "schema_observations_form_workspace_fk",
      "monitor_runs_schedule_workspace_fk",
    ])
      expect(migrations).toContain(`CONSTRAINT "${constraint}" FOREIGN KEY`);
    expect(migrations).toContain(
      'FOREIGN KEY ("submission_id","workspace_id") REFERENCES "public"."submissions"("id","workspace_id")',
    );
    expect(migrations).toContain(
      'FOREIGN KEY ("request_id","workspace_id") REFERENCES "public"."report_requests"("id","workspace_id")',
    );
  });
  it("creates composite parent uniqueness before dependent foreign keys", async () => {
    const migration = await readFile(
      new URL("../migrations/0005_bitter_bulldozer.sql", import.meta.url),
      "utf8",
    );
    expect(migration.indexOf('CREATE UNIQUE INDEX "forms_id_workspace_unique"')).toBeLessThan(
      migration.indexOf('CONSTRAINT "scanner_runs_form_workspace_fk"'),
    );
    expect(
      migration.indexOf('CREATE UNIQUE INDEX "routing_rule_versions_id_workspace_unique"'),
    ).toBeLessThan(migration.indexOf('CONSTRAINT "routing_decisions_version_workspace_fk"'));
  });
});
