import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { retryDelay, type LeasedJob } from "@formsentinel/queue";
import type { ScopedTokenRecord, ScopedTokenRepository } from "@formsentinel/security";
export type Phase3EntityKind =
  | "integration_analysis"
  | "integration_finding"
  | "repair_prompt"
  | "scanner_run"
  | "scanner_evidence"
  | "schema_observation"
  | "schema_version"
  | "drift_decision"
  | "schema_mapping"
  | "drift_ignore_rule"
  | "monitor_schedule"
  | "monitor_run"
  | "monitor_incident"
  | "incident_event"
  | "alert_policy"
  | "alert_delivery"
  | "reliability_snapshot"
  | "reliability_component"
  | "reliability_evidence"
  | "routing_rule_set"
  | "routing_rule_version"
  | "routing_decision"
  | "integration_catalog"
  | "integration_connection"
  | "integration_delivery"
  | "integration_health"
  | "scoped_token"
  | "oauth_token"
  | "analytics_event"
  | "analytics_aggregate"
  | "analytics_consent"
  | "agency_account"
  | "agency_client_grant"
  | "agency_template"
  | "agency_branding"
  | "report_request"
  | "report_artifact"
  | "report_evidence_manifest"
  | "audit_event";
export type Phase3Queue =
  | "scan"
  | "health"
  | "alerts"
  | "reliability"
  | "integration_delivery"
  | "analytics_aggregation"
  | "reports";
export interface Phase3Record<T = Record<string, unknown>> {
  id: string;
  kind: Phase3EntityKind;
  workspaceId: string;
  formId: string | null;
  data: T;
  version: number;
  immutable: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface Phase3Job {
  id: string;
  queue: Phase3Queue;
  type: string;
  payload: Record<string, string>;
  dedupeKey: string;
  status: "pending" | "leased" | "retry" | "completed" | "dead_letter";
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}
interface Phase3State {
  records: Phase3Record[];
  jobs: Phase3Job[];
}
interface Root {
  phase3?: Phase3State;
  [key: string]: unknown;
}
const empty = (): Phase3State => ({ records: [], jobs: [] });
const iso = (date = new Date()) => date.toISOString();
export class OptimisticLockError extends Error {
  constructor() {
    super("optimistic_lock_failed");
  }
}
export class LocalPhase3Store {
  private readonly file: string;
  constructor(file: string, environment: "development" | "test" | "production" = "development") {
    if (environment === "production")
      throw new Error("The local Phase 3 adapter is disabled in production.");
    this.file = resolve(file);
  }
  private async read(): Promise<Root> {
    try {
      return JSON.parse(await readFile(this.file, "utf8")) as Root;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
      throw error;
    }
  }
  private async locked<T>(operation: (state: Phase3State) => T | Promise<T>): Promise<T> {
    await mkdir(dirname(this.file), { recursive: true });
    const lock = `${this.file}.lock`;
    const deadline = Date.now() + 5_000;
    while (true) {
      try {
        await mkdir(lock);
        break;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
        if (Date.now() >= deadline) throw new Error("Timed out acquiring Phase 3 store lock.");
        await new Promise((done) => setTimeout(done, 10));
      }
    }
    try {
      const root = await this.read();
      const state = root.phase3 ?? empty();
      root.phase3 = state;
      const result = await operation(state);
      const temporary = `${this.file}.${process.pid}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(root, null, 2), { mode: 0o600 });
      await rename(temporary, this.file);
      return result;
    } finally {
      await rm(lock, { recursive: true, force: true });
    }
  }
  async create<T extends Record<string, unknown>>(
    input: {
      kind: Phase3EntityKind;
      workspaceId: string;
      formId?: string | null;
      data: T;
      immutable?: boolean;
      id?: string;
    },
    now = new Date(),
  ): Promise<Phase3Record<T>> {
    return this.locked((state) => {
      if (input.id && state.records.some((record) => record.id === input.id))
        throw new Error("duplicate_id");
      const record: Phase3Record<T> = {
        id: input.id ?? randomUUID(),
        kind: input.kind,
        workspaceId: input.workspaceId,
        formId: input.formId ?? null,
        data: structuredClone(input.data),
        version: 1,
        immutable: input.immutable ?? false,
        createdAt: iso(now),
        updatedAt: iso(now),
      };
      state.records.push(record);
      return structuredClone(record);
    });
  }
  async findByDataValue<T = Record<string, unknown>>(
    kind: Phase3EntityKind,
    key: string,
    value: string,
  ): Promise<Phase3Record<T> | null> {
    const record = (await this.read()).phase3?.records.find(
      (item) =>
        item.kind === kind &&
        typeof item.data === "object" &&
        item.data !== null &&
        (item.data as Record<string, unknown>)[key] === value,
    );
    return record ? structuredClone(record as Phase3Record<T>) : null;
  }
  async get<T = Record<string, unknown>>(
    workspaceId: string,
    kind: Phase3EntityKind,
    id: string,
  ): Promise<Phase3Record<T> | null> {
    const state = (await this.read()).phase3;
    const record = state?.records.find(
      (item) => item.id === id && item.kind === kind && item.workspaceId === workspaceId,
    );
    return record ? structuredClone(record as Phase3Record<T>) : null;
  }
  async list<T = Record<string, unknown>>(
    workspaceId: string,
    kind: Phase3EntityKind,
    formId?: string,
  ): Promise<readonly Phase3Record<T>[]> {
    return ((await this.read()).phase3?.records ?? [])
      .filter(
        (item) =>
          item.workspaceId === workspaceId &&
          item.kind === kind &&
          (!formId || item.formId === formId),
      )
      .map((item) => structuredClone(item as Phase3Record<T>));
  }
  async update<T extends Record<string, unknown>>(
    workspaceId: string,
    kind: Phase3EntityKind,
    id: string,
    expectedVersion: number,
    data: T,
    now = new Date(),
  ): Promise<Phase3Record<T>> {
    return this.locked((state) => {
      const record = state.records.find(
        (item) => item.id === id && item.kind === kind && item.workspaceId === workspaceId,
      );
      if (!record) throw new Error("not_found");
      if (record.immutable) throw new Error("immutable_record");
      if (record.version !== expectedVersion) throw new OptimisticLockError();
      record.data = structuredClone(data);
      record.version += 1;
      record.updatedAt = iso(now);
      return structuredClone(record as Phase3Record<T>);
    });
  }
  async enqueue(
    queue: Phase3Queue,
    type: string,
    ids: Record<string, string>,
    dedupeKey: string,
    now = new Date(),
    maxAttempts = 5,
  ): Promise<Phase3Job> {
    if (
      !Object.keys(ids).length ||
      Object.values(ids).some((value) => typeof value !== "string" || !value || value.length > 200)
    )
      throw new Error("queue_payload_ids_only");
    if (Object.keys(ids).some((key) => !/(?:^id$|Id$|Ids$)/.test(key)))
      throw new Error("queue_payload_ids_only");
    return this.locked((state) => {
      const prior = state.jobs.find((job) => job.queue === queue && job.dedupeKey === dedupeKey);
      if (prior) return structuredClone(prior);
      const job: Phase3Job = {
        id: randomUUID(),
        queue,
        type,
        payload: { ...ids },
        dedupeKey,
        status: "pending",
        attempts: 0,
        maxAttempts,
        nextAttemptAt: iso(now),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastError: null,
        createdAt: iso(now),
        updatedAt: iso(now),
      };
      state.jobs.push(job);
      return structuredClone(job);
    });
  }
  async claimQueue(
    queue: Phase3Queue,
    owner: string,
    limit: number,
    leaseMs: number,
    now = new Date(),
  ): Promise<readonly LeasedJob<Record<string, string>>[]> {
    return this.claim(queue, owner, limit, leaseMs, now);
  }
  async claim(
    queue: Phase3Queue,
    owner: string,
    limit: number,
    leaseMs: number,
    now = new Date(),
  ): Promise<readonly LeasedJob<Record<string, string>>[]> {
    return this.locked((state) => {
      const timestamp = now.getTime();
      for (const job of state.jobs)
        if (
          job.queue === queue &&
          job.status === "leased" &&
          Date.parse(job.leaseExpiresAt ?? "") <= timestamp &&
          job.attempts >= job.maxAttempts
        ) {
          job.status = "dead_letter";
          job.leaseOwner = null;
          job.leaseExpiresAt = null;
          job.updatedAt = iso(now);
          job.lastError ||= "Lease expired after maximum attempts.";
        }
      return state.jobs
        .filter(
          (job) =>
            job.queue === queue &&
            job.attempts < job.maxAttempts &&
            (((job.status === "pending" || job.status === "retry") &&
              Date.parse(job.nextAttemptAt) <= timestamp) ||
              (job.status === "leased" && Date.parse(job.leaseExpiresAt ?? "") <= timestamp)),
        )
        .slice(0, Math.max(0, limit))
        .map((job) => {
          job.status = "leased";
          job.attempts += 1;
          job.leaseOwner = owner;
          job.leaseExpiresAt = iso(new Date(timestamp + leaseMs));
          job.updatedAt = iso(now);
          return {
            id: job.id,
            type: job.type,
            payload: { ...job.payload },
            attempts: job.attempts,
            maxAttempts: job.maxAttempts,
            leaseOwner: owner,
            leaseExpiresAt: job.leaseExpiresAt!,
          };
        });
    });
  }
  async complete(jobId: string, owner: string, now = new Date()): Promise<boolean> {
    return this.locked((state) => {
      const job = state.jobs.find(
        (item) =>
          item.id === jobId &&
          item.status === "leased" &&
          item.leaseOwner === owner &&
          Date.parse(item.leaseExpiresAt ?? "") > now.getTime(),
      );
      if (!job) return false;
      job.status = "completed";
      job.leaseOwner = null;
      job.leaseExpiresAt = null;
      job.updatedAt = iso(now);
      return true;
    });
  }
  async fail(
    jobId: string,
    owner: string,
    message: string,
    now = new Date(),
  ): Promise<"retry" | "dead_letter" | "lost_lease"> {
    return this.locked((state) => {
      const job = state.jobs.find(
        (item) => item.id === jobId && item.status === "leased" && item.leaseOwner === owner,
      );
      if (!job) return "lost_lease";
      job.leaseOwner = null;
      job.leaseExpiresAt = null;
      job.lastError = message.slice(0, 2000);
      job.updatedAt = iso(now);
      if (job.attempts >= job.maxAttempts) {
        job.status = "dead_letter";
        return "dead_letter";
      }
      job.status = "retry";
      job.nextAttemptAt = iso(new Date(now.getTime() + retryDelay(job.attempts)));
      return "retry";
    });
  }
}
export interface Phase3Repository {
  create<T extends Record<string, unknown>>(
    input: {
      kind: Phase3EntityKind;
      workspaceId: string;
      formId?: string | null;
      data: T;
      immutable?: boolean;
      id?: string;
    },
    now?: Date,
  ): Promise<Phase3Record<T>>;
  get<T = Record<string, unknown>>(
    workspaceId: string,
    kind: Phase3EntityKind,
    id: string,
  ): Promise<Phase3Record<T> | null>;
  list<T = Record<string, unknown>>(
    workspaceId: string,
    kind: Phase3EntityKind,
    formId?: string,
  ): Promise<readonly Phase3Record<T>[]>;
  update<T extends Record<string, unknown>>(
    workspaceId: string,
    kind: Phase3EntityKind,
    id: string,
    expectedVersion: number,
    data: T,
    now?: Date,
  ): Promise<Phase3Record<T>>;
}

export class LocalScopedTokenRepository implements ScopedTokenRepository {
  constructor(private readonly store: LocalPhase3Store) {}
  async insert(record: ScopedTokenRecord): Promise<void> {
    await this.store.create({
      id: record.id,
      kind: "scoped_token",
      workspaceId: record.workspaceId,
      data: structuredClone(record) as unknown as Record<string, unknown>,
    });
  }
  async findByHash(hash: string): Promise<ScopedTokenRecord | null> {
    // The keyed hash is the lookup material; plaintext tokens never enter durable state.
    const record = await this.store.findByDataValue<ScopedTokenRecord>(
      "scoped_token",
      "tokenHash",
      hash,
    );
    return record ? structuredClone(record.data) : null;
  }
  async revoke(id: string, workspaceId: string, at: string): Promise<boolean> {
    const record = await this.store.get<Record<string, unknown>>(workspaceId, "scoped_token", id);
    if (!record) return false;
    const token = record.data as unknown as ScopedTokenRecord;
    if (token.revokedAt) return false;
    await this.store.update(workspaceId, "scoped_token", id, record.version, {
      ...token,
      revokedAt: at,
    } as unknown as Record<string, unknown>);
    return true;
  }
}
