import { describe, expect, it } from "vitest";
import { AttributionTokens, LocalAnalyticsStore } from "./index";
describe("privacy-safe analytics", () => {
  it("requires consent for conversion and rejects PII/arbitrary dimensions", () => {
    const store = new LocalAnalyticsStore("test");
    const base = { workspaceId: "w1", formId: "f1", dimensions: {}, metrics: { count: 1 } };
    expect(() => store.record({ ...base, name: "conversion_viewed" }, "essential")).toThrow(
      "consent",
    );
    expect(() =>
      store.record(
        { ...base, name: "submission_received", dimensions: { source: "person@example.test" } },
        "analytics",
      ),
    ).toThrow("rejected");
    for (const source of [
      "2001:db8::1",
      "[2001:db8::1]:443",
      "192.168.1.2:8080",
      "person%40example.test",
      Buffer.from("person@example.test").toString("base64"),
    ])
      expect(() =>
        store.record({ ...base, name: "submission_received", dimensions: { source } }, "analytics"),
      ).toThrow("rejected");
    expect(() =>
      store.record(
        { ...base, name: "submission_received", dimensions: { arbitrary: "x" } as never },
        "analytics",
      ),
    ).toThrow("rejected");
    store.record(
      {
        ...base,
        name: "submission_received",
        dimensions: { source: "search" },
        metrics: { latencyMs: 10 },
      },
      "essential",
    );
    expect(store.aggregate("w1", "f1")[0]).toMatchObject({ count: 1, averageLatencyMs: 10 });
  });
  it("uses short-lived single-use attribution tokens", async () => {
    const tokens = new AttributionTokens("test-attribution-secret", 1000);
    const now = new Date(0);
    const token = await tokens.issue({ formId: "f1", source: "search" }, now);
    expect(await tokens.consume(token, "f1", new Date(1))).toEqual({ source: "search" });
    await expect(tokens.consume(token, "f1", new Date(2))).rejects.toThrow("replay");
    await expect(
      tokens.consume(await tokens.issue({ formId: "f1" }, now), "f1", new Date(1001)),
    ).rejects.toThrow("invalid");
  });
});
