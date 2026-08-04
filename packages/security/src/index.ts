import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
export function hashSensitiveValue(value: string, secret: string): string {
  return createHash("sha256").update(secret).update("\0").update(value).digest("hex");
}
export function hashNetworkAddress(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}
export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Frame-Options": "DENY",
} as const;

export interface DataKey {
  keyId: string;
  version: number;
  bytes: Uint8Array;
}
export interface KeyProvider {
  activeKey(purpose: string): Promise<DataKey>;
  keyById(keyId: string, version: number): Promise<DataKey>;
}
export interface EncryptedEnvelope {
  algorithm: "aes-256-gcm";
  keyId: string;
  keyVersion: number;
  iv: string;
  tag: string;
  ciphertext: string;
}
export class LocalKeyProvider implements KeyProvider {
  private readonly key: DataKey;
  constructor(
    material: string,
    environment: "development" | "test" | "production" = "development",
  ) {
    if (environment === "production")
      throw new Error("Local key provider is disabled in production.");
    if (material.length < 16) throw new Error("Local key material must be at least 16 characters.");
    this.key = {
      keyId: "local-development",
      version: 1,
      bytes: createHash("sha256").update(material).digest(),
    };
  }
  async activeKey(_purpose: string): Promise<DataKey> {
    return this.key;
  }
  async keyById(keyId: string, version: number): Promise<DataKey> {
    if (keyId !== this.key.keyId || version !== this.key.version)
      throw new Error("Encryption key unavailable.");
    return this.key;
  }
}
export async function envelopeEncrypt(
  value: string,
  provider: KeyProvider,
  purpose: string,
): Promise<EncryptedEnvelope> {
  const key = await provider.activeKey(purpose);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.bytes, iv);
  cipher.setAAD(Buffer.from(purpose));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return {
    algorithm: "aes-256-gcm",
    keyId: key.keyId,
    keyVersion: key.version,
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}
export async function envelopeDecrypt(
  envelope: EncryptedEnvelope,
  provider: KeyProvider,
  purpose: string,
): Promise<string> {
  if (envelope.algorithm !== "aes-256-gcm") throw new Error("Unsupported encryption algorithm.");
  const key = await provider.keyById(envelope.keyId, envelope.keyVersion);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key.bytes,
    Buffer.from(envelope.iv, "base64url"),
  );
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(Buffer.from(envelope.tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
const sensitiveKey =
  /(?:authorization|cookie|password|secret|token|email|payload|body|ip|credential)/i;
export function redactMetadata(value: unknown, depth = 0): unknown {
  if (depth > 6) return "[REDACTED_DEPTH]";
  if (Array.isArray(value))
    return value.slice(0, 100).map((item) => redactMetadata(item, depth + 1));
  if (!value || typeof value !== "object")
    return typeof value === "string" && value.length > 500 ? `${value.slice(0, 500)}…` : value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .slice(0, 100)
      .map(([key, item]) => [
        key,
        sensitiveKey.test(key) ? "[REDACTED]" : redactMetadata(item, depth + 1),
      ]),
  );
}
export type TokenScope =
  | "forms:read"
  | "forms:create"
  | "schema:read"
  | "schema:write"
  | "health:read"
  | "reliability:read"
  | "integration:generate"
  | "submissions:test"
  | "tokens:manage";
export interface ScopedTokenRecord {
  id: string;
  prefix: string;
  tokenHash: string;
  workspaceId: string;
  formIds: readonly string[];
  scopes: readonly TokenScope[];
  expiresAt: string;
  revokedAt: string | null;
  rateLimitPerMinute: number;
  createdAt: string;
}
export interface ScopedTokenRepository {
  insert(record: ScopedTokenRecord): Promise<void>;
  findByHash(hash: string): Promise<ScopedTokenRecord | null>;
  revoke(id: string, workspaceId: string, at: string): Promise<boolean>;
}
export interface AuditSink {
  emit(event: {
    workspaceId: string;
    action: string;
    targetId: string;
    metadata: unknown;
    at: string;
  }): Promise<void>;
}
export class MemoryScopedTokenRepository implements ScopedTokenRepository {
  private readonly records: ScopedTokenRecord[] = [];
  constructor(environment: "development" | "test" | "production" = "development") {
    if (environment === "production")
      throw new Error("Memory token repository is disabled in production.");
  }
  async insert(record: ScopedTokenRecord) {
    this.records.push(record);
  }
  async findByHash(hash: string) {
    return this.records.find((record) => constantTimeEqual(record.tokenHash, hash)) ?? null;
  }
  async revoke(id: string, workspaceId: string, at: string) {
    const index = this.records.findIndex(
      (record) => record.id === id && record.workspaceId === workspaceId && !record.revokedAt,
    );
    if (index < 0) return false;
    this.records[index] = { ...this.records[index]!, revokedAt: at };
    return true;
  }
}
export class ScopedTokenService {
  private readonly uses = new Map<string, number[]>();
  constructor(
    private readonly repository: ScopedTokenRepository,
    private readonly hashSecret: string,
    private readonly audit: AuditSink = { emit: async () => undefined },
  ) {
    if (hashSecret.length < 16)
      throw new Error("Token hash secret must be at least 16 characters.");
  }
  private hash(token: string) {
    return createHmac("sha256", this.hashSecret).update(token).digest("hex");
  }
  async issue(
    input: {
      workspaceId: string;
      formIds?: readonly string[];
      scopes: readonly TokenScope[];
      expiresAt: Date;
      rateLimitPerMinute?: number;
    },
    now = new Date(),
  ): Promise<{ token: string; record: Omit<ScopedTokenRecord, "tokenHash"> }> {
    if (input.expiresAt <= now) throw new Error("Token expiration must be in the future.");
    const token = `fsmcp_${randomBytes(32).toString("base64url")}`;
    const record: ScopedTokenRecord = {
      id: crypto.randomUUID(),
      prefix: token.slice(0, 12),
      tokenHash: this.hash(token),
      workspaceId: input.workspaceId,
      formIds: [...new Set(input.formIds ?? [])],
      scopes: [...new Set(input.scopes)],
      expiresAt: input.expiresAt.toISOString(),
      revokedAt: null,
      rateLimitPerMinute: Math.min(600, Math.max(1, input.rateLimitPerMinute ?? 60)),
      createdAt: now.toISOString(),
    };
    await this.repository.insert(record);
    await this.audit.emit({
      workspaceId: record.workspaceId,
      action: "token.issued",
      targetId: record.id,
      metadata: redactMetadata({ scopes: record.scopes, formIds: record.formIds }),
      at: now.toISOString(),
    });
    const { tokenHash: _, ...publicRecord } = record;
    return { token, record: publicRecord };
  }
  private async authenticatedRecord(
    token: string,
    workspaceId: string,
    now: Date,
  ): Promise<ScopedTokenRecord> {
    if (!token.startsWith("fsmcp_") || token.length < 30) throw new Error("unauthorized");
    const record = await this.repository.findByHash(this.hash(token));
    if (!record || record.revokedAt || Date.parse(record.expiresAt) <= now.getTime())
      throw new Error("unauthorized");
    if (record.workspaceId !== workspaceId) throw new Error("forbidden");
    return record;
  }
  async authenticate(
    token: string,
    workspaceId: string,
    now = new Date(),
  ): Promise<ScopedTokenRecord> {
    return this.authenticatedRecord(token, workspaceId, now);
  }
  async authorize(
    token: string,
    request: { workspaceId: string; formId?: string; scope: TokenScope },
    now = new Date(),
  ): Promise<ScopedTokenRecord> {
    const record = await this.authenticatedRecord(token, request.workspaceId, now);
    if (!record.scopes.includes(request.scope)) throw new Error("forbidden");
    if (request.formId && record.formIds.length > 0 && !record.formIds.includes(request.formId))
      throw new Error("forbidden");
    const cutoff = now.getTime() - 60_000;
    const uses = (this.uses.get(record.id) ?? []).filter((item) => item > cutoff);
    if (uses.length >= record.rateLimitPerMinute) throw new Error("rate_limited");
    uses.push(now.getTime());
    this.uses.set(record.id, uses);
    await this.audit.emit({
      workspaceId: record.workspaceId,
      action: "token.used",
      targetId: record.id,
      metadata: redactMetadata({ scope: request.scope, formId: request.formId }),
      at: now.toISOString(),
    });
    return record;
  }
  async revoke(id: string, workspaceId: string, now = new Date()) {
    const revoked = await this.repository.revoke(id, workspaceId, now.toISOString());
    if (revoked)
      await this.audit.emit({
        workspaceId,
        action: "token.revoked",
        targetId: id,
        metadata: {},
        at: now.toISOString(),
      });
    return revoked;
  }
}

export function httpSecurityHeaders(production: boolean): Readonly<Record<string, string>> {
  return {
    "content-security-policy": [
      "default-src 'self'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
      "form-action 'self'",
      "object-src 'none'",
      "img-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "connect-src 'self'",
    ].join("; "),
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
    ...(production ? { "strict-transport-security": "max-age=31536000; includeSubDomains" } : {}),
  };
}

export function trustedRequestHost(host: string | null, allowedHosts: readonly string[]): boolean {
  if (!host) return false;
  const normalized = host.toLowerCase().replace(/\.$/, "");
  return allowedHosts.some((allowed) => normalized === allowed.toLowerCase().replace(/\.$/, ""));
}

export function validCsrfOrigin(origin: string | null, expectedOrigin: string): boolean {
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(expectedOrigin).origin;
  } catch {
    return false;
  }
}
