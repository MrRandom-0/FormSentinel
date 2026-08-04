import { createHash, randomUUID } from "node:crypto";
export interface SchemaField {
  name: string;
  type: string;
  required: boolean;
  validation?: Readonly<Record<string, unknown>>;
  file?: Readonly<Record<string, unknown>>;
}
export interface CanonicalSchema {
  fields: readonly SchemaField[];
}
export type DriftChangeType =
  | "addition"
  | "removal"
  | "rename_candidate"
  | "type"
  | "required"
  | "validation"
  | "file"
  | "nesting";
export interface DriftChange {
  type: DriftChangeType;
  field: string;
  previous?: unknown;
  observed?: unknown;
  candidate?: string;
  confidence?: number;
}
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
};
const distance = (a: string, b: string): number => {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const prior = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = prior;
    }
  }
  return row[b.length]!;
};
export function diffSchemas(
  previous: CanonicalSchema,
  observed: CanonicalSchema,
): readonly DriftChange[] {
  const oldFields = new Map(previous.fields.map((field) => [field.name, field]));
  const newFields = new Map(observed.fields.map((field) => [field.name, field]));
  const changes: DriftChange[] = [];
  const removed = previous.fields.filter((field) => !newFields.has(field.name));
  const added = observed.fields.filter((field) => !oldFields.has(field.name));
  for (const field of added) changes.push({ type: "addition", field: field.name, observed: field });
  for (const field of removed)
    changes.push({ type: "removal", field: field.name, previous: field });
  for (const oldField of removed) {
    const candidate = added
      .filter((item) => item.type === oldField.type)
      .map((item) => ({
        item,
        score:
          1 -
          distance(oldField.name.toLowerCase(), item.name.toLowerCase()) /
            Math.max(oldField.name.length, item.name.length, 1),
      }))
      .filter((item) => item.score >= 0.5)
      .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))[0];
    if (candidate)
      changes.push({
        type: "rename_candidate",
        field: oldField.name,
        candidate: candidate.item.name,
        confidence: Number(candidate.score.toFixed(3)),
      });
  }
  for (const [name, oldField] of oldFields) {
    const next = newFields.get(name);
    if (!next) continue;
    if (oldField.type !== next.type)
      changes.push({ type: "type", field: name, previous: oldField.type, observed: next.type });
    if (oldField.required !== next.required)
      changes.push({
        type: "required",
        field: name,
        previous: oldField.required,
        observed: next.required,
      });
    if (canonical(oldField.validation ?? {}) !== canonical(next.validation ?? {}))
      changes.push({
        type: "validation",
        field: name,
        previous: oldField.validation ?? {},
        observed: next.validation ?? {},
      });
    if (canonical(oldField.file ?? {}) !== canonical(next.file ?? {}))
      changes.push({
        type: "file",
        field: name,
        previous: oldField.file ?? {},
        observed: next.file ?? {},
      });
  }
  for (const field of observed.fields)
    if (/[.[\]]/.test(field.name))
      changes.push({ type: "nesting", field: field.name, observed: "nested_field_name" });
  return changes.sort((a, b) => a.field.localeCompare(b.field) || a.type.localeCompare(b.type));
}
export function driftFingerprint(changes: readonly DriftChange[]): string {
  return createHash("sha256").update(canonical(changes)).digest("hex");
}
export interface ImmutableSchemaVersion {
  id: string;
  formId: string;
  version: number;
  definition: CanonicalSchema;
  parentVersionId: string | null;
  reason: "initial" | "accept" | "rollback";
  createdAt: string;
}
export interface SchemaObservation {
  id: string;
  formId: string;
  expectedVersionId: string;
  observed: CanonicalSchema;
  changes: readonly DriftChange[];
  fingerprint: string;
  firstSubmissionId: string | null;
  deploymentId: string | null;
  status: "open" | "accepted" | "mapped" | "ignored" | "rejected";
  version: number;
  createdAt: string;
}
export class DriftLifecycle {
  private readonly versions: ImmutableSchemaVersion[] = [];
  private readonly observations: SchemaObservation[] = [];
  private readonly ignores = new Map<string, string>();
  private activeVersionId: string | null = null;
  constructor(environment: "development" | "test" | "production" = "development") {
    if (environment === "production")
      throw new Error("In-memory drift lifecycle is disabled in production.");
  }
  initialize(
    formId: string,
    definition: CanonicalSchema,
    now = new Date(),
  ): ImmutableSchemaVersion {
    if (this.activeVersionId) throw new Error("already_initialized");
    const record = {
      id: randomUUID(),
      formId,
      version: 1,
      definition: structuredClone(definition),
      parentVersionId: null,
      reason: "initial" as const,
      createdAt: now.toISOString(),
    };
    this.versions.push(record);
    this.activeVersionId = record.id;
    return structuredClone(record);
  }
  observe(
    formId: string,
    observed: CanonicalSchema,
    evidence: { submissionId?: string; deploymentId?: string } = {},
    now = new Date(),
  ): SchemaObservation | null {
    const active = this.versions.find(
      (item) => item.id === this.activeVersionId && item.formId === formId,
    );
    if (!active) throw new Error("active_schema_missing");
    const changes = diffSchemas(active.definition, observed);
    if (!changes.length) return null;
    const fingerprint = driftFingerprint(changes);
    if (Date.parse(this.ignores.get(fingerprint) ?? "") > now.getTime()) return null;
    const record: SchemaObservation = {
      id: randomUUID(),
      formId,
      expectedVersionId: active.id,
      observed: structuredClone(observed),
      changes,
      fingerprint,
      firstSubmissionId: evidence.submissionId ?? null,
      deploymentId: evidence.deploymentId ?? null,
      status: "open",
      version: 1,
      createdAt: now.toISOString(),
    };
    this.observations.push(record);
    return structuredClone(record);
  }
  decide(
    id: string,
    expectedVersion: number,
    action: "accept" | "map" | "ignore" | "reject",
    options: { mapping?: Readonly<Record<string, string>>; ignoreUntil?: Date } = {},
    now = new Date(),
  ): {
    observation: SchemaObservation;
    newVersion?: ImmutableSchemaVersion;
    mapping?: Readonly<Record<string, string>>;
  } {
    const record = this.observations.find((item) => item.id === id);
    if (!record) throw new Error("not_found");
    if (record.version !== expectedVersion || record.status !== "open")
      throw new Error("optimistic_lock_failed");
    if (action === "ignore") {
      if (!options.ignoreUntil || options.ignoreUntil <= now)
        throw new Error("invalid_ignore_expiry");
      this.ignores.set(record.fingerprint, options.ignoreUntil.toISOString());
    }
    if (action === "map" && (!options.mapping || !Object.keys(options.mapping).length))
      throw new Error("mapping_required");
    record.status =
      action === "accept"
        ? "accepted"
        : action === "map"
          ? "mapped"
          : action === "ignore"
            ? "ignored"
            : "rejected";
    record.version += 1;
    if (action !== "accept")
      return {
        observation: structuredClone(record),
        ...(options.mapping ? { mapping: structuredClone(options.mapping) } : {}),
      };
    const parent = this.versions.find((item) => item.id === this.activeVersionId)!;
    const created: ImmutableSchemaVersion = {
      id: randomUUID(),
      formId: record.formId,
      version:
        Math.max(
          ...this.versions
            .filter((item) => item.formId === record.formId)
            .map((item) => item.version),
        ) + 1,
      definition: structuredClone(record.observed),
      parentVersionId: parent.id,
      reason: "accept",
      createdAt: now.toISOString(),
    };
    this.versions.push(created);
    this.activeVersionId = created.id;
    return { observation: structuredClone(record), newVersion: structuredClone(created) };
  }
  rollback(versionId: string, now = new Date()): ImmutableSchemaVersion {
    const target = this.versions.find((item) => item.id === versionId);
    const active = this.versions.find((item) => item.id === this.activeVersionId);
    if (!target || !active || target.formId !== active.formId) throw new Error("not_found");
    const created: ImmutableSchemaVersion = {
      id: randomUUID(),
      formId: target.formId,
      version:
        Math.max(
          ...this.versions
            .filter((item) => item.formId === target.formId)
            .map((item) => item.version),
        ) + 1,
      definition: structuredClone(target.definition),
      parentVersionId: active.id,
      reason: "rollback",
      createdAt: now.toISOString(),
    };
    this.versions.push(created);
    this.activeVersionId = created.id;
    return structuredClone(created);
  }
  active(): ImmutableSchemaVersion | null {
    const value = this.versions.find((item) => item.id === this.activeVersionId);
    return value ? structuredClone(value) : null;
  }
}
export function visualSchemaDiff(changes: readonly DriftChange[]): string {
  if (!changes.length) return "No schema changes.";
  return changes
    .map(
      (change) =>
        `${change.type === "addition" ? "+" : change.type === "removal" ? "-" : "~"} ${change.field}: ${change.type}${change.candidate ? ` -> ${change.candidate}` : ""}`,
    )
    .join("\n");
}
