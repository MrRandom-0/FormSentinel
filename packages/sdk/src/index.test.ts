import { describe, expect, it, vi } from "vitest";
import { FormSentinelClient, FormSentinelError } from "./index";
describe("SDK", () => {
  it("sends idempotency and returns structured success", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("idempotency-key")).toBe("key");
      return Response.json(
        { success: true, submission_id: "id", request_id: "request", message: "accepted" },
        { status: 202 },
      );
    }) as typeof fetch;
    const client = new FormSentinelClient({ endpoint: "https://ingest.test", fetch: fetcher });
    expect(
      (await client.submit({ email: "person@example.test" }, { idempotencyKey: "key" }))
        .submission_id,
    ).toBe("id");
  });
  it("throws structured errors", async () => {
    const client = new FormSentinelClient({
      endpoint: "https://ingest.test",
      fetch: async () =>
        Response.json(
          {
            success: false,
            request_id: "r",
            error: { code: "validation_failed", message: "Invalid" },
          },
          { status: 422 },
        ),
    });
    await expect(client.submit({})).rejects.toBeInstanceOf(FormSentinelError);
  });
  it("normalizes non-JSON service errors", async () => {
    const client = new FormSentinelClient({
      endpoint: "https://ingest.test",
      fetch: async () =>
        new Response("bad gateway", { status: 502, headers: { "x-request-id": "r" } }),
    });
    await expect(client.submit({})).rejects.toMatchObject({
      status: 502,
      response: { request_id: "r", error: { code: "invalid_response" } },
    });
  });
  it("leaves FormData content type to fetch", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).has("content-type")).toBe(false);
      return Response.json({ success: true, submission_id: "id", request_id: "r", message: "ok" });
    }) as typeof fetch;
    const data = new FormData();
    data.set("email", "person@example.test");
    await new FormSentinelClient({ endpoint: "https://ingest.test", fetch: fetcher }).submit(data);
  });
});
