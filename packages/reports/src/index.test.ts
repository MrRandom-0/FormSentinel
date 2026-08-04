import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalPrivateStorage } from "@formsentinel/storage";
import { MemoryReportEvidenceRepository, MemoryReportRepository, ReportService } from "./index";
const dirs: string[] = [];
afterEach(async () =>
  Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))),
);
describe("evidence reports", () => {
  it("persists canonical evidence manifests discoverable after restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fs-report-"));
    dirs.push(dir);
    const storage = new LocalPrivateStorage(dir, "test");
    const repository = new MemoryReportRepository("test");
    const evidence = new MemoryReportEvidenceRepository(
      [
        {
          id: "e1",
          workspaceId: "w1",
          type: "scanner_evidence",
          version: "1",
          checksumSha256: "a".repeat(64),
          link: "https://example.test/e1",
        },
        {
          id: "e2",
          workspaceId: "w2",
          type: "scanner_evidence",
          version: "1",
          checksumSha256: "b".repeat(64),
        },
      ],
      "test",
    );
    const service = new ReportService(storage, repository, evidence);
    const input = {
      workspaceId: "w1",
      kind: "weekly_reliability" as const,
      summary: "<script>x</script>",
      metrics: { score: 90 },
      incidents: [{ id: "i1", summary: "Recovered" }],
      changes: ["schema accepted"],
      recommendations: ["Add CAPTCHA"],
      evidence: [{ id: "e1" }],
    };
    const artifact = await service.generate(input, "html");
    const restarted = new ReportService(storage, repository, evidence);
    const body = new TextDecoder().decode(await restarted.download("w1", artifact.id));
    expect(body).toContain("&lt;script&gt;");
    expect(body).not.toContain("<script>x</script>");
    const manifest = await restarted.manifest("w1", artifact.id);
    expect(manifest.evidence).toEqual([
      expect.objectContaining({ id: "e1", type: "scanner_evidence", version: "1" }),
    ]);
    expect(manifest.checksumSha256).toBe(artifact.manifestChecksumSha256);
    await expect(restarted.download("w2", artifact.id)).rejects.toThrow("forbidden");
    await expect(service.generate(input, "pdf")).rejects.toThrow("pdf_renderer_unavailable");
  });
  it("rejects forged and cross-workspace evidence identifiers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fs-report-"));
    dirs.push(dir);
    const service = new ReportService(
      new LocalPrivateStorage(dir, "test"),
      new MemoryReportRepository("test"),
      new MemoryReportEvidenceRepository(
        [
          {
            id: "other-evidence",
            workspaceId: "w2",
            type: "incident",
            version: "1",
            checksumSha256: "c".repeat(64),
          },
        ],
        "test",
      ),
    );
    const base = {
      workspaceId: "w1",
      kind: "incident" as const,
      summary: "summary",
      metrics: {},
      incidents: [],
      changes: [],
      recommendations: [],
    };
    await expect(
      service.generate({ ...base, evidence: [{ id: "forged" }] }, "json"),
    ).rejects.toThrow("report_evidence_forbidden");
    await expect(
      service.generate({ ...base, evidence: [{ id: "other-evidence" }] }, "json"),
    ).rejects.toThrow("report_evidence_forbidden");
  });
});
