import { createHmac, randomBytes } from "node:crypto";
import { Pool } from "pg";
import type { RateLimiter } from "@formsentinel/queue";

export const apiKeyScopes = [
  "forms:read",
  "submissions:read",
  "submissions:write",
  "submissions:export",
] as const;
export type ApiKeyScope = (typeof apiKeyScopes)[number];
export interface ApiKeyRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly prefix: string;
  readonly keyHash: string;
  readonly scopes: readonly ApiKeyScope[];
  readonly formGrants: readonly string[];
  readonly expiresAt: string | null;
  readonly rotatedFromId: string | null;
  readonly createdByUserId: string;
  readonly lastUsedAt: string | null;
  readonly revokedAt: string | null;
  readonly createdAt: string;
}
export interface ApiKeyAudit {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly action: string;
  readonly keyId: string;
  readonly at: string;
}
export interface ApiKeyRepository {
  insert(record: ApiKeyRecord, audit: ApiKeyAudit): Promise<void>;
  findByHash(hash: string): Promise<ApiKeyRecord | null>;
  touch(id: string, at: string): Promise<void>;
  revoke(workspaceId: string, id: string, actorId: string, at: string): Promise<boolean>;
}
export class MemoryApiKeyRepository implements ApiKeyRepository {
  readonly records = new Map<string, ApiKeyRecord>();
  readonly audit: ApiKeyAudit[] = [];
  constructor(environment: "development" | "test" | "production" = "development") {
    if (environment === "production")
      throw new Error("Memory API keys are disabled in production.");
  }
  async insert(record: ApiKeyRecord, audit: ApiKeyAudit) {
    this.records.set(record.id, record);
    this.audit.push(audit);
  }
  async findByHash(hash: string) {
    return [...this.records.values()].find((item) => item.keyHash === hash) ?? null;
  }
  async touch(id: string, at: string) {
    const item = this.records.get(id);
    if (item) this.records.set(id, { ...item, lastUsedAt: at });
  }
  async revoke(workspaceId: string, id: string, actorId: string, at: string) {
    const item = this.records.get(id);
    if (!item || item.workspaceId !== workspaceId || item.revokedAt) return false;
    this.records.set(id, { ...item, revokedAt: at });
    this.audit.push({ workspaceId, actorId, action: "api_key.revoked", keyId: id, at });
    return true;
  }
}
export class PostgresApiKeyRepository implements ApiKeyRepository {
  readonly pool: Pool;
  constructor(connection: string | Pool) {
    this.pool =
      typeof connection === "string" ? new Pool({ connectionString: connection }) : connection;
  }
  async close() {
    await this.pool.end();
  }
  async insert(record: ApiKeyRecord, audit: ApiKeyAudit) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO api_keys (id,workspace_id,name,prefix,key_hash,scopes,form_grants,expires_at,rotated_from_id,created_by_user_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
        [
          record.id,
          record.workspaceId,
          record.name,
          record.prefix,
          record.keyHash,
          record.scopes,
          record.formGrants,
          record.expiresAt,
          record.rotatedFromId,
          record.createdByUserId,
          record.createdAt,
        ],
      );
      await client.query(
        "INSERT INTO audit_logs (workspace_id,actor_user_id,action,target_type,target_id,metadata,created_at) VALUES ($1,$2,$3,'api_key',$4,'{}',$5)",
        [audit.workspaceId, audit.actorId, audit.action, audit.keyId, audit.at],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  async findByHash(hash: string) {
    const result = await this.pool.query<Record<string, unknown>>(
      "SELECT * FROM api_keys WHERE key_hash=$1",
      [hash],
    );
    const row = result.rows[0];
    return row ? rowToRecord(row) : null;
  }
  async touch(id: string, at: string) {
    await this.pool.query("UPDATE api_keys SET last_used_at=$2 WHERE id=$1", [id, at]);
  }
  async revoke(workspaceId: string, id: string, actorId: string, at: string) {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        "UPDATE api_keys SET revoked_at=$3 WHERE id=$1 AND workspace_id=$2 AND revoked_at IS NULL RETURNING id",
        [id, workspaceId, at],
      );
      if (result.rowCount)
        await client.query(
          "INSERT INTO audit_logs (workspace_id,actor_user_id,action,target_type,target_id,metadata,created_at) VALUES ($1,$2,'api_key.revoked','api_key',$3,'{}',$4)",
          [workspaceId, actorId, id, at],
        );
      await client.query("COMMIT");
      return Boolean(result.rowCount);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const iso = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : typeof value === "string" ? value : null;
const rowToRecord = (row: Record<string, unknown>): ApiKeyRecord => ({
  id: String(row.id),
  workspaceId: String(row.workspace_id),
  name: String(row.name),
  prefix: String(row.prefix),
  keyHash: String(row.key_hash),
  scopes: strings(row.scopes) as ApiKeyScope[],
  formGrants: strings(row.form_grants),
  expiresAt: iso(row.expires_at),
  rotatedFromId: row.rotated_from_id ? String(row.rotated_from_id) : null,
  createdByUserId: String(row.created_by_user_id),
  lastUsedAt: iso(row.last_used_at),
  revokedAt: iso(row.revoked_at),
  createdAt: iso(row.created_at)!,
});
export class ApiKeyService {
  constructor(
    private readonly repository: ApiKeyRepository,
    private readonly hashSecret: string,
    private readonly rateLimiter?: RateLimiter,
  ) {
    if (hashSecret.length < 32)
      throw new Error("API key hash secret must be at least 32 characters.");
  }
  private hash(token: string) {
    return createHmac("sha256", this.hashSecret).update(token).digest("hex");
  }
  async issue(
    input: {
      workspaceId: string;
      name: string;
      scopes: readonly ApiKeyScope[];
      formGrants?: readonly string[];
      expiresAt?: Date;
      actorId: string;
      rotatedFromId?: string;
    },
    now = new Date(),
  ) {
    if (input.expiresAt && input.expiresAt <= now) throw new Error("api_key_expiry_invalid");
    if (input.scopes.some((scope) => !apiKeyScopes.includes(scope)))
      throw new Error("api_key_scope_invalid");
    const token = `fsapi_${randomBytes(32).toString("base64url")}`;
    const record: ApiKeyRecord = {
      id: crypto.randomUUID(),
      workspaceId: input.workspaceId,
      name: input.name.trim().slice(0, 100),
      prefix: token.slice(0, 14),
      keyHash: this.hash(token),
      scopes: [...new Set(input.scopes)],
      formGrants: [...new Set(input.formGrants ?? [])],
      expiresAt: input.expiresAt?.toISOString() ?? null,
      rotatedFromId: input.rotatedFromId ?? null,
      createdByUserId: input.actorId,
      lastUsedAt: null,
      revokedAt: null,
      createdAt: now.toISOString(),
    };
    await this.repository.insert(record, {
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      action: input.rotatedFromId ? "api_key.rotated" : "api_key.issued",
      keyId: record.id,
      at: now.toISOString(),
    });
    return { token, record: { ...record, keyHash: undefined } };
  }
  async authorize(
    token: string,
    request: { workspaceId: string; scope: ApiKeyScope; formId?: string },
    now = new Date(),
  ) {
    if (!token.startsWith("fsapi_")) throw new Error("invalid_api_credential_type");
    const record = await this.repository.findByHash(this.hash(token));
    if (
      !record ||
      record.workspaceId !== request.workspaceId ||
      record.revokedAt ||
      (record.expiresAt && record.expiresAt <= now.toISOString())
    )
      throw new Error("invalid_api_key");
    if (
      !record.scopes.includes(request.scope) ||
      (request.formId && record.formGrants.length && !record.formGrants.includes(request.formId))
    )
      throw new Error("forbidden");
    if (this.rateLimiter) {
      const result = await this.rateLimiter.consume(
        `api-key:${record.id}`,
        600,
        60_000,
        now.getTime(),
      );
      if (!result.allowed) throw new Error("rate_limited");
    }
    await this.repository.touch(record.id, now.toISOString());
    return record;
  }
  async rotate(
    workspaceId: string,
    id: string,
    input: {
      name: string;
      scopes: readonly ApiKeyScope[];
      formGrants?: readonly string[];
      expiresAt?: Date;
      actorId: string;
    },
    now = new Date(),
  ) {
    const issued = await this.issue({ ...input, workspaceId, rotatedFromId: id }, now);
    await this.repository.revoke(workspaceId, id, input.actorId, now.toISOString());
    return issued;
  }
  revoke(workspaceId: string, id: string, actorId: string, now = new Date()) {
    return this.repository.revoke(workspaceId, id, actorId, now.toISOString());
  }
}
