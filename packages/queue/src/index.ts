import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { Pool } from "pg";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimiter {
  consume(key: string, limit: number, windowMs: number, now?: number): Promise<RateLimitResult>;
}

export class MemorySlidingWindowRateLimiter implements RateLimiter {
  private readonly entries = new Map<string, number[]>();

  constructor(environment: "development" | "test" | "production" = "development") {
    if (environment === "production")
      throw new Error("Memory rate limiting is disabled in production.");
  }

  async consume(
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): Promise<RateLimitResult> {
    const start = now - windowMs;
    const current = (this.entries.get(key) ?? []).filter((value) => value > start);
    if (current.length >= limit) {
      this.entries.set(key, current);
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(((current[0] ?? now) + windowMs - now) / 1000)),
      };
    }
    current.push(now);
    this.entries.set(key, current);
    return { allowed: true, remaining: limit - current.length, retryAfterSeconds: 0 };
  }
}

/**
 * Durable fixed-window limiter. Capacity is exact per key/window and atomic across processes;
 * unlike the local limiter it does not provide sliding-window smoothing.
 */
export class PostgresFixedWindowRateLimiter implements RateLimiter {
  readonly pool: Pool;
  constructor(connection: string | Pool) {
    this.pool =
      typeof connection === "string" ? new Pool({ connectionString: connection }) : connection;
  }
  async close(): Promise<void> {
    await this.pool.end();
  }
  async consume(
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): Promise<RateLimitResult> {
    const scopeHash = createHash("sha256").update(key).digest("hex");
    const bucketStartMs = Math.floor(now / windowMs) * windowMs;
    const bucketStart = new Date(bucketStartMs);
    const expiresAt = new Date(bucketStartMs + windowMs * 2);
    const result = await this.pool.query<{ count: number }>(
      `INSERT INTO rate_limit_buckets (scope_hash,bucket_start,count,expires_at)
       VALUES ($1,$2,1,$3)
       ON CONFLICT (scope_hash,bucket_start) DO UPDATE
       SET count=rate_limit_buckets.count+1,expires_at=EXCLUDED.expires_at
       RETURNING count`,
      [scopeHash, bucketStart, expiresAt],
    );
    const count = Number(result.rows[0]?.count ?? limit + 1);
    return count <= limit
      ? { allowed: true, remaining: Math.max(0, limit - count), retryAfterSeconds: 0 }
      : {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((bucketStartMs + windowMs - now) / 1000)),
        };
  }
}

export function retryDelay(
  attempt: number,
  baseMs = 1_000,
  maximumMs = 3_600_000,
  random = Math.random,
): number {
  const exponential = Math.min(maximumMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(exponential * (0.75 + random() * 0.5));
}

export function trustedSourceAddress(
  directAddress: string,
  forwardedFor: string | null,
  trustedHops = 0,
): string {
  const direct = normalizeAddress(directAddress);
  if (!trustedHops || !forwardedFor) return direct;
  const chain = forwardedFor
    .split(",")
    .map((part) => normalizeAddress(part.trim()))
    .filter((part) => isIP(part) > 0);
  chain.push(direct);
  if (chain.length < trustedHops + 1) return direct;
  return chain[chain.length - trustedHops - 1] ?? direct;
}

function normalizeAddress(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("[")) return trimmed.slice(1, trimmed.indexOf("]"));
  const ipv4WithPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(trimmed);
  return ipv4WithPort?.[1] ?? trimmed;
}

export interface LeasedJob<T = unknown> {
  id: string;
  type: string;
  payload: T;
  attempts: number;
  maxAttempts: number;
  leaseOwner: string;
  leaseExpiresAt: string;
}

export interface DurableQueue {
  claim(owner: string, limit: number, leaseMs: number, now?: Date): Promise<readonly LeasedJob[]>;
  complete(jobId: string, owner: string, now?: Date): Promise<boolean>;
  fail(
    jobId: string,
    owner: string,
    error: string,
    now?: Date,
  ): Promise<"retry" | "dead_letter" | "lost_lease">;
}

export const phase3Queues = [
  "scan",
  "health",
  "alerts",
  "reliability",
  "integration_delivery",
  "analytics_aggregation",
  "reports",
] as const;
export type Phase3QueueName = (typeof phase3Queues)[number];
export interface GeneralizedDurableQueue {
  claimQueue(
    queue: Phase3QueueName,
    owner: string,
    limit: number,
    leaseMs: number,
    now?: Date,
  ): Promise<readonly LeasedJob<Record<string, string>>[]>;
  complete(jobId: string, owner: string, now?: Date): Promise<boolean>;
  fail(
    jobId: string,
    owner: string,
    error: string,
    now?: Date,
  ): Promise<"retry" | "dead_letter" | "lost_lease">;
}
export type Phase3JobHandler = (
  ids: Readonly<Record<string, string>>,
  job: LeasedJob<Record<string, string>>,
) => Promise<void>;
export function assertIdsOnlyPayload(value: unknown): asserts value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("queue_payload_ids_only");
  const entries = Object.entries(value as Record<string, unknown>);
  if (
    !entries.length ||
    entries.some(
      ([key, item]) =>
        !/(?:^id$|Id$|Ids$)/.test(key) || typeof item !== "string" || !item || item.length > 200,
    )
  )
    throw new Error("queue_payload_ids_only");
}
