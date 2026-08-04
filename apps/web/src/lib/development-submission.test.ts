import { describe, expect, it, vi } from "vitest";
import { handleDevelopmentSubmission } from "./development-submission";

const form = {
  name: "Contact",
  allowedOrigins: ["https://allowed.example"],
  honeypotField: "fax",
  notificationEmail: null,
  fields: [
    { name: "email", type: "email" as const, required: true },
    { name: "consent", type: "checkbox" as const, required: true },
  ],
};

function dependencies() {
  return {
    environment: "test" as const,
    getForm: vi.fn(async () => form),
    capture: vi.fn(async () => ({ id: "capture-1", stages: ["received", "validated"] })),
  };
}

function request(method: "POST" | "OPTIONS", origin?: string, body: unknown = {}) {
  const headers = new Headers();
  if (origin) headers.set("origin", origin);
  if (method === "POST") headers.set("content-type", "application/json");
  const init: RequestInit = { method, headers };
  if (method === "POST") init.body = JSON.stringify(body);
  return new Request("http://localhost/v1/forms/public/submissions", init);
}

describe("development submission request policy", () => {
  it("allows configured-origin preflight and post with CORS headers", async () => {
    const deps = dependencies();
    const preflight = await handleDevelopmentSubmission(
      request("OPTIONS", "https://allowed.example"),
      "public",
      deps,
    );
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe("https://allowed.example");
    expect(preflight.headers.get("vary")).toBe("Origin");

    const post = await handleDevelopmentSubmission(
      request("POST", "https://allowed.example", {
        email: "person@example.test",
        consent: true,
      }),
      "public",
      deps,
    );
    expect(post.status).toBe(202);
    expect(post.headers.get("access-control-allow-origin")).toBe("https://allowed.example");
    expect(deps.capture).toHaveBeenCalledOnce();
  });

  it.each(["OPTIONS", "POST"] as const)("denies unconfigured-origin %s", async (method) => {
    const response = await handleDevelopmentSubmission(
      request(method, "https://denied.example", { email: "person@example.test", consent: true }),
      "public",
      dependencies(),
    );
    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("permits no-Origin development tools without adding an allow-origin header", async () => {
    const response = await handleDevelopmentSubmission(
      request("POST", undefined, { email: "person@example.test", consent: true }),
      "public",
      dependencies(),
    );
    expect(response.status).toBe(202);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(response.headers.get("vary")).toBe("Origin");
  });

  it("does not expose pipeline stages or capture before schema validation passes", async () => {
    const deps = dependencies();
    const response = await handleDevelopmentSubmission(
      request("POST", "https://allowed.example", {
        email: "not-an-email",
        consent: false,
        unknown: "value",
      }),
      "public",
      deps,
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({
      error: "validation_failed",
      fields: { email: expect.any(String), consent: expect.any(String), unknown: "Unknown field" },
    });
    expect(deps.capture).not.toHaveBeenCalled();
  });

  it("rejects non-object JSON roots", async () => {
    const response = await handleDevelopmentSubmission(
      request("POST", undefined, ["invalid"]),
      "public",
      dependencies(),
    );
    expect(response.status).toBe(400);
  });
});
