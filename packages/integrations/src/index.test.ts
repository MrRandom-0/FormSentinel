import { describe, expect, it, vi } from "vitest";
import {
  CapturedLocalIntegrationAdapter,
  integrationKeys,
  localIntegrationRegistry,
  MemoryIntegrationCaptureRepository,
  retryableIntegrationResult,
  SignedGenericWebhookAdapter,
  UnavailableIntegrationAdapter,
} from "./index";
describe("integration registry", () => {
  it("captures every named provider locally without faking delivery", async () => {
    const registry = localIntegrationRegistry("test");
    expect([...registry.keys()]).toEqual(integrationKeys);
    const slack = registry.get("slack")!;
    expect(await slack.connect({})).toBe("captured_local");
    expect((await slack.deliver({ deliveryId: "d1", payload: {}, configuration: {} })).state).toBe(
      "captured_local",
    );
    await slack.disconnect();
    expect((await slack.deliver({ deliveryId: "d2", payload: {}, configuration: {} })).state).toBe(
      "unavailable",
    );
  });
  it("persists one immutable redacted capture before reporting captured_local", async () => {
    const captures = new MemoryIntegrationCaptureRepository("test");
    const adapter = new CapturedLocalIntegrationAdapter("slack", "test", captures, "w1");
    await adapter.connect({});
    expect(
      await adapter.deliver({
        deliveryId: "delivery-1",
        payload: { email: "person@example.test", event: "created" },
        configuration: { channel: "alerts", token: "secret" },
      }),
    ).toMatchObject({ state: "captured_local" });
    await adapter.deliver({
      deliveryId: "delivery-1",
      payload: { event: "mutated" },
      configuration: { channel: "other" },
    });
    expect(await captures.get("w1", "delivery-1")).toMatchObject({
      deliveryId: "delivery-1",
      payload: "[REDACTED]",
      configuration: { channel: "alerts", token: "[REDACTED]" },
    });
  });
  it("reports unavailable official adapters honestly", async () =>
    expect(await new UnavailableIntegrationAdapter("notion").connect({})).toBe("unavailable"));
  it("signs real generic webhook transport and classifies retries", async () => {
    const deliver = vi.fn(
      async (_url: string, _body: string, _headers: Record<string, string>) => ({
        status: 503,
        state: "delivered" as const,
      }),
    );
    const adapter = new SignedGenericWebhookAdapter({ deliver }, "secret");
    const result = await adapter.deliver({
      deliveryId: "d1",
      payload: { ok: true },
      configuration: { url: "https://hooks.example.test" },
    });
    expect(deliver.mock.calls[0]?.[2]["x-formsentinel-signature"]).toBeTruthy();
    expect(retryableIntegrationResult(result)).toBe(true);
  });
  it("forbids captured adapters in production", () =>
    expect(() => new CapturedLocalIntegrationAdapter("slack", "production")).toThrow());
});
