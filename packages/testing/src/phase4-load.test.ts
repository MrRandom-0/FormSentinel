import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { MemoryUsageRepository } from "@formsentinel/usage";
describe("bounded deterministic load smoke", () => {
  it("deduplicates 1000 concurrent ledger replays within the local 2s smoke SLO", async () => {
    const usage = new MemoryUsageRepository("test");
    const started = performance.now();
    const results = await Promise.all(
      Array.from({ length: 1000 }, () =>
        usage.append({
          workspaceId: "load",
          plan: "agency",
          metric: "monthlySubmissions",
          quantity: 1,
          source: { sourceType: "submission", sourceId: "same-id" },
          at: new Date("2026-08-01"),
        }),
      ),
    );
    const elapsed = performance.now() - started;
    expect(results.filter((item) => item.inserted)).toHaveLength(1);
    expect(results.at(-1)?.snapshot.committed).toBe(1);
    expect(elapsed).toBeLessThan(2000);
  });
});
