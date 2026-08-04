import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAgencyStore } from "@formsentinel/agency";
import { analyzeIntegration } from "@formsentinel/integration-copilot";
import { CapturedLocalIntegrationAdapter } from "@formsentinel/integrations";
import { McpToolService, type McpRepository } from "@formsentinel/mcp-tools";
import { MonitorIncidentTracker, runMonitor } from "@formsentinel/monitoring";
import { calculateReliability } from "@formsentinel/reliability";
import {
  MemoryReportEvidenceRepository,
  MemoryReportRepository,
  ReportService,
} from "@formsentinel/reports";
import { evaluateRouting, type RoutingRule } from "@formsentinel/routing";
import { scanStaticHtml } from "@formsentinel/scanner";
import { DriftLifecycle } from "@formsentinel/schema-drift";
import { MemoryScopedTokenRepository, ScopedTokenService } from "@formsentinel/security";
import { LocalPrivateStorage } from "@formsentinel/storage";
const dirs: string[] = [];
afterEach(async () =>
  Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))),
);
describe("Phase 3 end-to-end local acceptance", () => {
  it("analyzes, scans, handles drift/health/routing/MCP/agency, and downloads evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fs-phase3-"));
    dirs.push(directory);
    const actual = {
      endpoint: "https://ingest.example/v1/forms/fs_test/submissions",
      fields: [{ name: "email", type: "email", required: true }],
      allowedOrigins: ["https://site.example"],
    };
    const source = `<form action="${actual.endpoint}" method="post"><label>Email<input name="email" type="email" required></label><button type="submit">Send</button><p role="status"></p></form>`;
    const analysis = analyzeIntegration(source, "html", actual);
    expect(analysis.supported).toBe(true);
    const scan = await scanStaticHtml(
      "https://site.example/contact",
      { actual },
      {
        resolveDns: async () => ["93.184.216.34"],
        transport: {
          request: async () => new Response(source, { headers: { "content-type": "text/html" } }),
        },
      },
    );
    expect(scan.status).toBe("complete");
    const drift = new DriftLifecycle("test");
    const first = drift.initialize("f1", { fields: actual.fields });
    const observation = drift.observe(
      "f1",
      { fields: [...actual.fields, { name: "topic", type: "text", required: false }] },
      { deploymentId: "deploy-1" },
    )!;
    expect(drift.decide(observation.id, 1, "accept").newVersion?.version).toBe(2);
    expect(drift.rollback(first.id).version).toBe(3);
    const checks = {
      pageReachability: async () => ({ ok: true }),
      staticFormDiscovery: async () => ({ forms: 1 }),
      endpoint: async () => ({ ok: true }),
      fields: async () => ({ matched: true }),
      submitSynthetic: async () => ({ test: true }),
      processing: async () => ({ processed: true }),
      delivery: async () => ({
        notifications: "suppressed",
        webhooks: "suppressed",
        crm: "suppressed",
      }),
    };
    const schedule = {
      id: "m1",
      workspaceId: "w1",
      formId: "f1",
      frequency: "manual" as const,
      active: true,
      nextRunAt: null,
    };
    const monitor = await runMonitor(schedule, checks);
    expect(monitor.synthetic).toBe(true);
    expect(monitor.steps.find((step) => step.step === "delivery")?.evidence).toMatchObject({
      notifications: "suppressed",
    });
    const tracker = new MonitorIncidentTracker(2, 2);
    const failed = { ...monitor, status: "failed" as const };
    expect(tracker.apply({ ...failed, id: "r1" })).toBeNull();
    expect(tracker.apply({ ...failed, id: "r2" })?.status).toBe("open");
    expect(tracker.apply({ ...monitor, id: "r3", status: "passed" })?.status).toBe("open");
    expect(tracker.apply({ ...monitor, id: "r4", status: "passed" })?.status).toBe("resolved");
    const reliability = calculateReliability({
      health: { state: "healthy", evidenceIds: ["r4"] },
      schema_stability: { state: "healthy", evidenceIds: [observation.id] },
      spam_captcha_domain: { state: "degraded" },
      notifications_webhooks_files: { state: "healthy" },
      last_real_submission: { state: "missing" },
      integration_verification: { state: "healthy" },
      accessibility: { state: "healthy", evidenceIds: ["scan-1"] },
    });
    expect(reliability.score).toBeGreaterThan(0);
    const rule: RoutingRule = {
      id: "route-1",
      name: "Sales",
      priority: 1,
      when: { kind: "compare", field: "topic", operator: "eq", value: "sales" },
      actions: { integrationIds: ["slack-local"], tags: ["sales"] },
    };
    const decision = evaluateRouting([rule], { topic: "sales" });
    expect(decision.integrationIds).toEqual(["slack-local"]);
    const integration = new CapturedLocalIntegrationAdapter("slack", "test");
    await integration.connect({});
    expect(
      (await integration.deliver({ deliveryId: "d1", payload: decision, configuration: {} })).state,
    ).toBe("captured_local");
    const forms = [{ id: "f1", workspaceId: "w1", name: "Contact", ...actual }];
    const repository: McpRepository = {
      listForms: async (workspaceId) => forms.filter((item) => item.workspaceId === workspaceId),
      getForm: async (workspaceId, formId) =>
        forms.find((item) => item.workspaceId === workspaceId && item.id === formId) ?? null,
      createForm: async () => forms[0]!,
      testSubmission: async () => ({
        submissionId: "synthetic-1",
        synthetic: true,
        externalSideEffectsSuppressed: true,
      }),
      health: async () => monitor,
      reliability: async () => reliability,
    };
    const tokens = new ScopedTokenService(
      new MemoryScopedTokenRepository("test"),
      "phase3-e2e-token-secret",
    );
    const issued = await tokens.issue({
      workspaceId: "w1",
      formIds: ["f1"],
      scopes: ["forms:read"],
      expiresAt: new Date(Date.now() + 60_000),
    });
    const mcp = new McpToolService(tokens, repository);
    expect(
      await mcp.call({ token: issued.token, workspaceId: "w1", name: "list_forms" }),
    ).toHaveLength(1);
    await expect(
      mcp.call({
        token: issued.token,
        workspaceId: "w1",
        name: "test_submission",
        arguments: { formId: "f1", confirm: true, idempotencyKey: "phase3-e2e" },
      }),
    ).rejects.toThrow("forbidden");
    const agency = new LocalAgencyStore("test");
    const account = agency.create("Agency", "owner");
    agency.grantClient("owner", account.id, "w1", ["health:read", "reports:read"]);
    expect(() => agency.requireClient("owner", account.id, "w2", "health:read")).toThrow(
      "forbidden",
    );
    const reports = new ReportService(
      new LocalPrivateStorage(join(directory, "reports"), "test"),
      new MemoryReportRepository("test"),
      new MemoryReportEvidenceRepository(
        [observation.id, "r4"].map((id) => ({
          id,
          workspaceId: "w1",
          type: "local_acceptance_evidence",
          version: "1",
          checksumSha256: "a".repeat(64),
        })),
        "test",
      ),
    );
    const artifact = await reports.generate(
      {
        workspaceId: "w1",
        kind: "weekly_reliability",
        summary: "Local Phase 3 acceptance",
        metrics: { score: reliability.score },
        incidents: [{ id: "incident-1", summary: "Resolved" }],
        changes: ["Schema version accepted and rollback version created"],
        recommendations: ["Configure a browser runtime for dynamic checks"],
        evidence: [{ id: observation.id }, { id: "r4" }],
      },
      "json",
    );
    expect(
      JSON.parse(new TextDecoder().decode(await reports.download("w1", artifact.id))),
    ).toMatchObject({ metrics: { score: reliability.score } });
    await expect(reports.download("w2", artifact.id)).rejects.toThrow("forbidden");
  });
});
