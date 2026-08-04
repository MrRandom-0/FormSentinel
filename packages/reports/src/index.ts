import { createHash } from "node:crypto";
import type { PrivateStorage } from "@formsentinel/storage";
import { safeCsvCell } from "@formsentinel/submissions";
export type ReportKind =
  "weekly_reliability" | "monthly_submissions" | "spam" | "delivery" | "incident" | "agency_client";
export type ReportFormat = "json" | "csv" | "html" | "pdf";
export interface ReportInput {
  workspaceId: string;
  requestId?: string;
  kind: ReportKind;
  summary: string;
  metrics: Readonly<Record<string, number | string | null>>;
  incidents: readonly { id: string; summary: string }[];
  changes: readonly string[];
  recommendations: readonly string[];
  evidence: readonly { id: string }[];
  branding?: { name: string; primaryColor?: string };
}
export interface ResolvedReportEvidence {
  id: string;
  workspaceId: string;
  type: string;
  version: string;
  checksumSha256: string;
  link?: string;
}
export interface ReportEvidenceRepository {
  resolve(workspaceId: string, evidenceId: string): Promise<ResolvedReportEvidence | null>;
}
export interface ReportArtifact {
  id: string;
  requestId: string;
  workspaceId: string;
  kind: ReportKind;
  format: Exclude<ReportFormat, "pdf">;
  storageKey: string;
  checksumSha256: string;
  manifestChecksumSha256: string;
  byteSize: number;
  evidenceIds: readonly string[];
  createdAt: string;
  expiresAt: string;
}
export interface ReportManifest {
  artifactId: string;
  version: "1";
  artifactChecksumSha256: string;
  evidence: readonly Omit<ResolvedReportEvidence, "workspaceId">[];
  checksumSha256: string;
}
export interface ReportRepository {
  saveArtifactAndManifest(artifact: ReportArtifact, manifest: ReportManifest): Promise<void>;
  findArtifact(workspaceId: string, artifactId: string): Promise<ReportArtifact | null>;
  findManifest(workspaceId: string, artifactId: string): Promise<ReportManifest | null>;
}
export class MemoryReportRepository implements ReportRepository {
  private readonly artifacts = new Map<string, ReportArtifact>();
  private readonly manifests = new Map<string, ReportManifest>();
  constructor(environment: "development" | "test" | "production" = "development") {
    if (environment === "production")
      throw new Error("Memory report repository is disabled in production.");
  }
  async saveArtifactAndManifest(artifact: ReportArtifact, manifest: ReportManifest): Promise<void> {
    if (this.artifacts.has(artifact.id)) throw new Error("duplicate_report_artifact");
    this.artifacts.set(artifact.id, structuredClone(artifact));
    this.manifests.set(artifact.id, structuredClone(manifest));
  }
  async findArtifact(workspaceId: string, artifactId: string): Promise<ReportArtifact | null> {
    const artifact = this.artifacts.get(artifactId);
    return artifact?.workspaceId === workspaceId ? structuredClone(artifact) : null;
  }
  async findManifest(workspaceId: string, artifactId: string): Promise<ReportManifest | null> {
    if (!(await this.findArtifact(workspaceId, artifactId))) return null;
    const manifest = this.manifests.get(artifactId);
    return manifest ? structuredClone(manifest) : null;
  }
}
export class MemoryReportEvidenceRepository implements ReportEvidenceRepository {
  constructor(
    private readonly evidence: readonly ResolvedReportEvidence[],
    environment: "development" | "test" | "production" = "development",
  ) {
    if (environment === "production")
      throw new Error("Memory report evidence is disabled in production.");
  }
  async resolve(workspaceId: string, evidenceId: string): Promise<ResolvedReportEvidence | null> {
    const evidence = this.evidence.find(
      (item) => item.workspaceId === workspaceId && item.id === evidenceId,
    );
    return evidence ? structuredClone(evidence) : null;
  }
}
const sha256 = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const escapeHtml = (value: unknown) =>
  String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
const safeLink = (value: string | undefined): string | null => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};
function render(
  input: Omit<ReportInput, "evidence"> & { evidence: readonly { id: string; link?: string }[] },
  format: Exclude<ReportFormat, "pdf">,
): Uint8Array {
  if (format === "json") return new TextEncoder().encode(JSON.stringify(input, null, 2));
  if (format === "csv") {
    const rows = [
      ["section", "key", "value"],
      ...Object.entries(input.metrics).map(([key, value]) => ["metric", key, value]),
      ...input.incidents.map((item) => ["incident", item.id, item.summary]),
      ...input.changes.map((item, index) => ["change", index, item]),
      ...input.recommendations.map((item, index) => ["recommendation", index, item]),
    ];
    return new TextEncoder().encode(rows.map((row) => row.map(safeCsvCell).join(",")).join("\r\n"));
  }
  const name = input.branding?.name ?? "FormSentinel";
  const color = /^#[0-9a-f]{6}$/i.test(input.branding?.primaryColor ?? "")
    ? input.branding!.primaryColor!
    : "#5b5cf0";
  return new TextEncoder().encode(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(name)} report</title><style>body{font:16px system-ui;max-width:900px;margin:auto;padding:2rem;color:#172033}h1,h2{color:${color}}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccd;padding:.5rem;text-align:left}</style></head><body><h1>${escapeHtml(name)} — ${escapeHtml(input.kind)}</h1><p>${escapeHtml(input.summary)}</p><h2>Metrics</h2><table><tbody>${Object.entries(
      input.metrics,
    )
      .map(([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value)}</td></tr>`)
      .join(
        "",
      )}</tbody></table><h2>Incidents</h2><ul>${input.incidents.map((item) => `<li id="${escapeHtml(item.id)}">${escapeHtml(item.summary)} (${escapeHtml(item.id)})</li>`).join("")}</ul><h2>Changes</h2><ul>${input.changes.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><h2>Recommendations</h2><ul>${input.recommendations.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul><h2>Evidence</h2><ul>${input.evidence.map((item) => `<li>${safeLink(item.link) ? `<a href="${escapeHtml(safeLink(item.link))}">` : ""}${escapeHtml(item.id)}${safeLink(item.link) ? "</a>" : ""}</li>`).join("")}</ul></body></html>`,
  );
}
export class ReportService {
  constructor(
    private readonly storage: PrivateStorage,
    private readonly repository: ReportRepository,
    private readonly evidenceRepository: ReportEvidenceRepository,
  ) {}
  async generate(
    input: ReportInput,
    format: ReportFormat,
    now = new Date(),
    expiresInMs = 7 * 86_400_000,
  ): Promise<ReportArtifact> {
    if (format === "pdf") throw new Error("pdf_renderer_unavailable");
    const evidence: ResolvedReportEvidence[] = [];
    for (const requested of input.evidence) {
      const resolved = await this.evidenceRepository.resolve(input.workspaceId, requested.id);
      if (!resolved || resolved.workspaceId !== input.workspaceId)
        throw new Error("report_evidence_forbidden");
      evidence.push(resolved);
    }
    const renderedInput = {
      ...input,
      evidence: evidence.map(({ id, link }) => ({ id, ...(link ? { link } : {}) })),
    };
    const bytes = render(renderedInput, format);
    const id = crypto.randomUUID();
    const storageKey = `reports/${input.workspaceId}/${id}.${format}`;
    const artifactChecksumSha256 = sha256(bytes);
    const canonicalEvidence = evidence
      .map(({ workspaceId: _, ...item }) => item)
      .sort((left, right) => left.id.localeCompare(right.id));
    const canonicalManifest = JSON.stringify({
      artifactId: id,
      version: "1",
      artifactChecksumSha256,
      evidence: canonicalEvidence,
    });
    const manifestChecksumSha256 = sha256(canonicalManifest);
    const stored = await this.storage.putQuarantined(storageKey, bytes);
    const artifact: ReportArtifact = {
      id,
      requestId: input.requestId ?? crypto.randomUUID(),
      workspaceId: input.workspaceId,
      kind: input.kind,
      format,
      storageKey,
      checksumSha256: artifactChecksumSha256,
      manifestChecksumSha256,
      byteSize: stored.byteSize,
      evidenceIds: canonicalEvidence.map((item) => item.id),
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + expiresInMs).toISOString(),
    };
    const manifest: ReportManifest = {
      artifactId: id,
      version: "1",
      artifactChecksumSha256,
      evidence: canonicalEvidence,
      checksumSha256: manifestChecksumSha256,
    };
    await this.repository.saveArtifactAndManifest(artifact, manifest);
    return structuredClone(artifact);
  }
  async download(workspaceId: string, artifactId: string, now = new Date()): Promise<Uint8Array> {
    const artifact = await this.repository.findArtifact(workspaceId, artifactId);
    if (!artifact) throw new Error("forbidden");
    if (Date.parse(artifact.expiresAt) <= now.getTime()) throw new Error("report_expired");
    const bytes = await this.storage.readAuthorized(artifact.storageKey);
    if (sha256(bytes) !== artifact.checksumSha256) throw new Error("report_checksum_mismatch");
    return bytes;
  }
  async manifest(workspaceId: string, artifactId: string): Promise<ReportManifest> {
    const manifest = await this.repository.findManifest(workspaceId, artifactId);
    if (!manifest) throw new Error("forbidden");
    const canonical = JSON.stringify({
      artifactId: manifest.artifactId,
      version: manifest.version,
      artifactChecksumSha256: manifest.artifactChecksumSha256,
      evidence: manifest.evidence,
    });
    if (sha256(canonical) !== manifest.checksumSha256)
      throw new Error("report_manifest_checksum_mismatch");
    return manifest;
  }
}
