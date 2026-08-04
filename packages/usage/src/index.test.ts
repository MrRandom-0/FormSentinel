import { describe, expect, it } from "vitest";
import { MemoryUsageRepository, UsageQuotaError } from "./index";

const at = new Date("2026-08-15T12:00:00Z");
describe("usage ledger", () => {
  it("deduplicates append sources and emits thresholds once", async () => {
    const usage = new MemoryUsageRepository("test");
    const input = {
      workspaceId: "w",
      plan: "free" as const,
      metric: "monthlySubmissions" as const,
      quantity: 80,
      source: { sourceType: "submission" as const, sourceId: "s1" },
      at,
    };
    const first = await usage.append(input);
    const replay = await usage.append(input);
    expect(first.thresholds.map((event) => event.threshold)).toEqual([80]);
    expect(replay).toMatchObject({ inserted: false, snapshot: { committed: 80 } });
  });
  it("serializes concurrent hard quota checks", async () => {
    const usage = new MemoryUsageRepository("test");
    const results = await Promise.allSettled(
      Array.from({ length: 110 }, (_, index) =>
        usage.append({
          workspaceId: "w",
          plan: "free",
          metric: "monthlySubmissions",
          quantity: 1,
          source: { sourceType: "submission", sourceId: `s${index}` },
          at,
        }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(100);
    expect(
      results.filter(
        (result) => result.status === "rejected" && result.reason instanceof UsageQuotaError,
      ),
    ).toHaveLength(10);
  });
  it("reserves and idempotently reconciles", async () => {
    const usage = new MemoryUsageRepository("test");
    const input = {
      workspaceId: "w",
      plan: "starter" as const,
      metric: "monthlySubmissions" as const,
      quantity: 2,
      source: { sourceType: "submission" as const, sourceId: "s1" },
      at,
      expiresAt: new Date("2026-08-15T12:05:00Z"),
    };
    const reservation = await usage.reserve(input);
    if (!("id" in reservation)) throw new Error("expected reservation");
    expect(await usage.reserve(input)).toMatchObject({ id: reservation.id, reserved: 2 });
    expect(await usage.reconcile(reservation.id, "commit", at)).toMatchObject({
      state: "committed",
      committed: 2,
      reserved: 0,
    });
    expect(await usage.reconcile(reservation.id, "commit", at)).toMatchObject({
      state: "committed",
      committed: 2,
    });
  });
  it("refuses memory persistence in production", () => {
    expect(() => new MemoryUsageRepository("production")).toThrow(/disabled in production/);
  });
});
