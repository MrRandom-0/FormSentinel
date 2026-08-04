import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { resolveEntitlements, type PlanId } from "@formsentinel/entitlements";

export type UsageMetric = "monthlySubmissions" | "storageBytes";
export type UsageSourceType = "submission" | "storage" | "reconciliation";
export interface UsageSource {
  readonly sourceType: UsageSourceType;
  readonly sourceId: string;
}
export interface UsageSnapshot {
  readonly workspaceId: string;
  readonly metric: UsageMetric;
  readonly bucketMonth: string;
  readonly committed: number;
  readonly reserved: number;
  readonly limit: number;
}
export interface UsageReservation extends UsageSnapshot, UsageSource {
  readonly id: string;
  readonly quantity: number;
  readonly state: "reserved" | "committed" | "released";
}
export type UsageThreshold = 80 | 100 | 120;
export interface UsageThresholdEvent {
  readonly workspaceId: string;
  readonly metric: UsageMetric;
  readonly bucketMonth: string;
  readonly threshold: UsageThreshold;
}
export type UsageCheck =
  | { readonly allowed: true; readonly snapshot: UsageSnapshot }
  | {
      readonly allowed: false;
      readonly reason: "monthly_quota_reached";
      readonly snapshot: UsageSnapshot;
    };

export interface UsageRepository {
  check(
    workspaceId: string,
    plan: PlanId,
    metric: UsageMetric,
    quantity?: number,
    at?: Date,
  ): Promise<UsageCheck>;
  reserve(input: {
    workspaceId: string;
    plan: PlanId;
    metric: UsageMetric;
    quantity: number;
    source: UsageSource;
    at?: Date;
    expiresAt: Date;
  }): Promise<UsageReservation | UsageCheck>;
  reconcile(
    reservationId: string,
    outcome: "commit" | "release",
    at?: Date,
  ): Promise<UsageReservation | null>;
  append(input: {
    workspaceId: string;
    plan: PlanId;
    metric: UsageMetric;
    quantity: number;
    source: UsageSource;
    correlationId?: string;
    at?: Date;
  }): Promise<{
    readonly inserted: boolean;
    readonly snapshot: UsageSnapshot;
    readonly thresholds: readonly UsageThresholdEvent[];
  }>;
}

export const monthBucket = (at: Date): string =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1)).toISOString();
const thresholdsCrossed = (before: number, after: number, limit: number): UsageThreshold[] =>
  ([80, 100, 120] as const).filter(
    (threshold) => before * 100 < limit * threshold && after * 100 >= limit * threshold,
  );

interface MutableCounter {
  committed: number;
  reserved: number;
}
interface MutableReservation {
  id: string;
  workspaceId: string;
  metric: UsageMetric;
  sourceType: UsageSourceType;
  sourceId: string;
  bucketMonth: string;
  quantity: number;
  state: "reserved" | "committed" | "released";
  plan: PlanId;
}
export class MemoryUsageRepository implements UsageRepository {
  private readonly counters = new Map<string, MutableCounter>();
  private readonly sources = new Map<string, true>();
  private readonly reservations = new Map<string, MutableReservation>();
  private chain = Promise.resolve();
  constructor(environment: "development" | "test" | "production" = "development") {
    if (environment === "production") throw new Error("Memory usage is disabled in production.");
  }
  private async exclusive<T>(operation: () => T | Promise<T>): Promise<T> {
    const previous = this.chain;
    let release!: () => void;
    this.chain = new Promise<void>((resolve) => (release = resolve));
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
  private keys(workspaceId: string, metric: UsageMetric, at: Date) {
    const bucketMonth = monthBucket(at);
    return { bucketMonth, key: `${workspaceId}:${metric}:${bucketMonth}` };
  }
  private snapshot(
    workspaceId: string,
    plan: PlanId,
    metric: UsageMetric,
    at: Date,
  ): UsageSnapshot {
    const { key, bucketMonth } = this.keys(workspaceId, metric, at);
    const counter = this.counters.get(key) ?? { committed: 0, reserved: 0 };
    return {
      workspaceId,
      metric,
      bucketMonth,
      ...counter,
      limit: resolveEntitlements({ plan, workspaceId }).limits[metric],
    };
  }
  async check(
    workspaceId: string,
    plan: PlanId,
    metric: UsageMetric,
    quantity = 1,
    at = new Date(),
  ): Promise<UsageCheck> {
    return this.exclusive(() => {
      const snapshot = this.snapshot(workspaceId, plan, metric, at);
      return snapshot.committed + snapshot.reserved + quantity > snapshot.limit
        ? { allowed: false as const, reason: "monthly_quota_reached" as const, snapshot }
        : { allowed: true as const, snapshot };
    });
  }
  async reserve(input: {
    workspaceId: string;
    plan: PlanId;
    metric: UsageMetric;
    quantity: number;
    source: UsageSource;
    at?: Date;
    expiresAt: Date;
  }): Promise<UsageReservation | UsageCheck> {
    return this.exclusive(() => {
      const at = input.at ?? new Date();
      const sourceKey = `${input.workspaceId}:${input.metric}:${input.source.sourceType}:${input.source.sourceId}`;
      const existing = [...this.reservations.values()].find(
        (item) =>
          `${item.workspaceId}:${item.metric}:${item.sourceType}:${item.sourceId}` === sourceKey,
      );
      if (existing)
        return {
          ...existing,
          ...this.snapshot(
            existing.workspaceId,
            existing.plan,
            existing.metric,
            new Date(existing.bucketMonth),
          ),
        };
      const snapshot = this.snapshot(input.workspaceId, input.plan, input.metric, at);
      if (snapshot.committed + snapshot.reserved + input.quantity > snapshot.limit)
        return { allowed: false as const, reason: "monthly_quota_reached" as const, snapshot };
      const counter = this.counters.get(this.keys(input.workspaceId, input.metric, at).key) ?? {
        committed: 0,
        reserved: 0,
      };
      counter.reserved += input.quantity;
      this.counters.set(this.keys(input.workspaceId, input.metric, at).key, counter);
      const reservation: MutableReservation = {
        id: randomUUID(),
        workspaceId: input.workspaceId,
        metric: input.metric,
        sourceType: input.source.sourceType,
        sourceId: input.source.sourceId,
        bucketMonth: snapshot.bucketMonth,
        quantity: input.quantity,
        state: "reserved",
        plan: input.plan,
      };
      this.reservations.set(reservation.id, reservation);
      return { ...reservation, ...this.snapshot(input.workspaceId, input.plan, input.metric, at) };
    });
  }
  async reconcile(
    reservationId: string,
    outcome: "commit" | "release",
    at = new Date(),
  ): Promise<UsageReservation | null> {
    return this.exclusive(() => {
      const reservation = this.reservations.get(reservationId);
      if (!reservation) return null;
      if (reservation.state === "reserved") {
        const key = this.keys(
          reservation.workspaceId,
          reservation.metric,
          new Date(reservation.bucketMonth),
        ).key;
        const counter = this.counters.get(key)!;
        counter.reserved -= reservation.quantity;
        if (outcome === "commit") {
          counter.committed += reservation.quantity;
          this.sources.set(
            `${reservation.workspaceId}:${reservation.metric}:${reservation.sourceType}:${reservation.sourceId}`,
            true,
          );
        }
        reservation.state = outcome === "commit" ? "committed" : "released";
      }
      return {
        ...reservation,
        ...this.snapshot(reservation.workspaceId, reservation.plan, reservation.metric, at),
      };
    });
  }
  async append(input: {
    workspaceId: string;
    plan: PlanId;
    metric: UsageMetric;
    quantity: number;
    source: UsageSource;
    correlationId?: string;
    at?: Date;
  }): Promise<{
    inserted: boolean;
    snapshot: UsageSnapshot;
    thresholds: readonly UsageThresholdEvent[];
  }> {
    return this.exclusive(() => {
      const at = input.at ?? new Date();
      const sourceKey = `${input.workspaceId}:${input.metric}:${input.source.sourceType}:${input.source.sourceId}`;
      const before = this.snapshot(input.workspaceId, input.plan, input.metric, at);
      if (this.sources.has(sourceKey)) return { inserted: false, snapshot: before, thresholds: [] };
      if (before.committed + before.reserved + input.quantity > before.limit)
        throw new UsageQuotaError(before);
      this.sources.set(sourceKey, true);
      const key = this.keys(input.workspaceId, input.metric, at).key;
      const counter = this.counters.get(key) ?? { committed: 0, reserved: 0 };
      counter.committed += input.quantity;
      this.counters.set(key, counter);
      const snapshot = this.snapshot(input.workspaceId, input.plan, input.metric, at);
      return {
        inserted: true,
        snapshot,
        thresholds: thresholdsCrossed(before.committed, snapshot.committed, snapshot.limit).map(
          (threshold) => ({
            workspaceId: input.workspaceId,
            metric: input.metric,
            bucketMonth: snapshot.bucketMonth,
            threshold,
          }),
        ),
      };
    });
  }
}

export class UsageQuotaError extends Error {
  constructor(readonly snapshot: UsageSnapshot) {
    super("Monthly usage quota reached.");
    this.name = "UsageQuotaError";
  }
}

export class PostgresUsageRepository implements UsageRepository {
  readonly pool: Pool;
  constructor(connection: string | Pool) {
    this.pool =
      typeof connection === "string" ? new Pool({ connectionString: connection }) : connection;
  }
  async close() {
    await this.pool.end();
  }
  private async transaction<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  private async lockedSnapshot(
    client: PoolClient,
    workspaceId: string,
    plan: PlanId,
    metric: UsageMetric,
    at: Date,
  ) {
    const bucket = monthBucket(at);
    await client.query(
      "INSERT INTO usage_counters (workspace_id,metric,bucket_month) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
      [workspaceId, metric, bucket],
    );
    const result = await client.query<{ committed: number; reserved: number }>(
      "SELECT committed,reserved FROM usage_counters WHERE workspace_id=$1 AND metric=$2 AND bucket_month=$3 FOR UPDATE",
      [workspaceId, metric, bucket],
    );
    return {
      workspaceId,
      metric,
      bucketMonth: bucket,
      committed: Number(result.rows[0]?.committed ?? 0),
      reserved: Number(result.rows[0]?.reserved ?? 0),
      limit: resolveEntitlements({ plan, workspaceId }).limits[metric],
    } satisfies UsageSnapshot;
  }
  async check(
    workspaceId: string,
    plan: PlanId,
    metric: UsageMetric,
    quantity = 1,
    at = new Date(),
  ): Promise<UsageCheck> {
    return this.transaction(async (client) => {
      const snapshot = await this.lockedSnapshot(client, workspaceId, plan, metric, at);
      return snapshot.committed + snapshot.reserved + quantity > snapshot.limit
        ? { allowed: false, reason: "monthly_quota_reached", snapshot }
        : { allowed: true, snapshot };
    });
  }
  async reserve(input: {
    workspaceId: string;
    plan: PlanId;
    metric: UsageMetric;
    quantity: number;
    source: UsageSource;
    at?: Date;
    expiresAt: Date;
  }): Promise<UsageReservation | UsageCheck> {
    return this.transaction(async (client) => {
      const at = input.at ?? new Date();
      const prior = await client.query<{
        id: string;
        state: UsageReservation["state"];
        bucket_month: Date;
      }>(
        "SELECT id,state,bucket_month FROM usage_reservations WHERE workspace_id=$1 AND metric=$2 AND source_type=$3 AND source_id=$4",
        [input.workspaceId, input.metric, input.source.sourceType, input.source.sourceId],
      );
      const snapshot = await this.lockedSnapshot(
        client,
        input.workspaceId,
        input.plan,
        input.metric,
        at,
      );
      if (prior.rows[0])
        return {
          id: prior.rows[0].id,
          ...input.source,
          quantity: input.quantity,
          state: prior.rows[0].state,
          ...snapshot,
        };
      if (snapshot.committed + snapshot.reserved + input.quantity > snapshot.limit)
        return { allowed: false, reason: "monthly_quota_reached", snapshot };
      const id = randomUUID();
      await client.query(
        "INSERT INTO usage_reservations (id,workspace_id,metric,source_type,source_id,quantity,bucket_month,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          id,
          input.workspaceId,
          input.metric,
          input.source.sourceType,
          input.source.sourceId,
          input.quantity,
          snapshot.bucketMonth,
          input.expiresAt,
        ],
      );
      await client.query(
        "UPDATE usage_counters SET reserved=reserved+$4,updated_at=$5 WHERE workspace_id=$1 AND metric=$2 AND bucket_month=$3",
        [input.workspaceId, input.metric, snapshot.bucketMonth, input.quantity, at],
      );
      return {
        id,
        ...input.source,
        quantity: input.quantity,
        state: "reserved",
        ...snapshot,
        reserved: snapshot.reserved + input.quantity,
      };
    });
  }
  async reconcile(
    reservationId: string,
    outcome: "commit" | "release",
    at = new Date(),
  ): Promise<UsageReservation | null> {
    return this.transaction(async (client) => {
      const found = await client.query<{
        workspace_id: string;
        metric: UsageMetric;
        source_type: UsageSourceType;
        source_id: string;
        quantity: number;
        bucket_month: Date;
        state: UsageReservation["state"];
      }>("SELECT * FROM usage_reservations WHERE id=$1 FOR UPDATE", [reservationId]);
      const row = found.rows[0];
      if (!row) return null;
      const planResult = await client.query<{ plan: PlanId }>(
        "SELECT plan FROM workspaces WHERE id=$1",
        [row.workspace_id],
      );
      const plan = planResult.rows[0]?.plan ?? "free";
      const snapshot = await this.lockedSnapshot(
        client,
        row.workspace_id,
        plan,
        row.metric,
        new Date(row.bucket_month),
      );
      if (row.state === "reserved") {
        await client.query(
          "UPDATE usage_counters SET reserved=reserved-$4,committed=committed+CASE WHEN $5='commit' THEN $4 ELSE 0 END,updated_at=$6 WHERE workspace_id=$1 AND metric=$2 AND bucket_month=$3",
          [row.workspace_id, row.metric, row.bucket_month, row.quantity, outcome, at],
        );
        if (outcome === "commit")
          await client.query(
            "INSERT INTO usage_events (workspace_id,metric,quantity,source_type,source_id,bucket_month,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
            [
              row.workspace_id,
              row.metric,
              row.quantity,
              row.source_type,
              row.source_id,
              row.bucket_month,
              at,
            ],
          );
        await client.query("UPDATE usage_reservations SET state=$2,reconciled_at=$3 WHERE id=$1", [
          reservationId,
          outcome === "commit" ? "committed" : "released",
          at,
        ]);
      }
      return {
        ...snapshot,
        id: reservationId,
        sourceType: row.source_type,
        sourceId: row.source_id,
        quantity: row.quantity,
        state:
          row.state === "reserved" ? (outcome === "commit" ? "committed" : "released") : row.state,
        ...snapshot,
      };
    });
  }
  async append(input: {
    workspaceId: string;
    plan: PlanId;
    metric: UsageMetric;
    quantity: number;
    source: UsageSource;
    correlationId?: string;
    at?: Date;
  }) {
    return this.transaction(async (client) => {
      const at = input.at ?? new Date();
      const before = await this.lockedSnapshot(
        client,
        input.workspaceId,
        input.plan,
        input.metric,
        at,
      );
      const prior = await client.query(
        "SELECT 1 FROM usage_events WHERE workspace_id=$1 AND metric=$2 AND source_type=$3 AND source_id=$4",
        [input.workspaceId, input.metric, input.source.sourceType, input.source.sourceId],
      );
      if (prior.rowCount) return { inserted: false, snapshot: before, thresholds: [] };
      if (before.committed + before.reserved + input.quantity > before.limit)
        throw new UsageQuotaError(before);
      await client.query(
        "INSERT INTO usage_events (workspace_id,metric,quantity,source_type,source_id,bucket_month,correlation_id,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          input.workspaceId,
          input.metric,
          input.quantity,
          input.source.sourceType,
          input.source.sourceId,
          before.bucketMonth,
          input.correlationId ?? null,
          at,
        ],
      );
      await client.query(
        "UPDATE usage_counters SET committed=committed+$4,updated_at=$5 WHERE workspace_id=$1 AND metric=$2 AND bucket_month=$3",
        [input.workspaceId, input.metric, before.bucketMonth, input.quantity, at],
      );
      const snapshot = { ...before, committed: before.committed + input.quantity };
      return {
        inserted: true,
        snapshot,
        thresholds: thresholdsCrossed(before.committed, snapshot.committed, snapshot.limit).map(
          (threshold) => ({
            workspaceId: input.workspaceId,
            metric: input.metric,
            bucketMonth: snapshot.bucketMonth,
            threshold,
          }),
        ),
      };
    });
  }
}
