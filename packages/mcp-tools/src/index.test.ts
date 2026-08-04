import { describe, expect, it, vi } from "vitest";
import { MemoryScopedTokenRepository, ScopedTokenService } from "@formsentinel/security";
import { defaultMcpScopes, McpToolService, type McpRepository } from "./index";
const forms = [
  {
    id: "f1",
    workspaceId: "w1",
    name: "Contact",
    endpoint: "https://ingest.example/f1",
    fields: [{ name: "email", type: "email", required: true }],
    allowedOrigins: ["https://site.example"],
  },
  {
    id: "f2",
    workspaceId: "w1",
    name: "Private",
    endpoint: "https://ingest.example/f2",
    fields: [{ name: "name", type: "text", required: true }],
    allowedOrigins: ["https://private.example"],
  },
];
const repository: McpRepository = {
  listForms: async (workspaceId) => forms.filter((item) => item.workspaceId === workspaceId),
  getForm: async (workspaceId, formId) =>
    forms.find((item) => item.workspaceId === workspaceId && item.id === formId) ?? null,
  createForm: vi.fn(async () => forms[0]!),
  testSubmission: vi.fn(async () => ({
    submissionId: "s1",
    synthetic: true as const,
    externalSideEffectsSuppressed: true as const,
  })),
  health: async () => ({ status: "ok" }),
  reliability: async () => ({ score: 90 }),
};
describe("MCP tools", () => {
  it("defaults exclude all submission access and enforces tenant/form grants", async () => {
    const tokens = new ScopedTokenService(
      new MemoryScopedTokenRepository("test"),
      "test-mcp-token-secret",
    );
    const service = new McpToolService(tokens, repository);
    expect(service.listTools(defaultMcpScopes)).not.toContain("test_submission");
    const now = new Date();
    const issued = await tokens.issue(
      {
        workspaceId: "w1",
        formIds: ["f1"],
        scopes: ["forms:read", "health:read"],
        expiresAt: new Date(now.getTime() + 60_000),
      },
      now,
    );
    const listed = (await service.call({
      token: issued.token,
      workspaceId: "w1",
      name: "list_forms",
    })) as typeof forms;
    expect(listed.map((form) => form.id)).toEqual(["f1"]);
    await expect(
      service.call({ token: issued.token, workspaceId: "w2", name: "list_forms" }),
    ).rejects.toThrow("forbidden");
    await expect(
      service.call({
        token: issued.token,
        workspaceId: "w1",
        name: "get_health_status",
      }),
    ).rejects.toThrow("workspace_grant_required");
    await expect(
      service.call({
        token: issued.token,
        workspaceId: "w1",
        name: "get_public_config",
        arguments: { formId: "f2" },
      }),
    ).rejects.toThrow("forbidden");
    await expect(
      service.call({
        token: issued.token,
        workspaceId: "w1",
        name: "test_submission",
        arguments: { formId: "f1", confirm: true, idempotencyKey: "12345678" },
      }),
    ).rejects.toThrow("forbidden");
  });
  it("allows only confirmed idempotent synthetic submission with dedicated scope", async () => {
    const tokens = new ScopedTokenService(
      new MemoryScopedTokenRepository("test"),
      "test-mcp-token-secret",
    );
    const issued = await tokens.issue({
      workspaceId: "w1",
      scopes: ["submissions:test"],
      expiresAt: new Date(Date.now() + 60_000),
    });
    const service = new McpToolService(tokens, repository);
    await expect(
      service.call({
        token: issued.token,
        workspaceId: "w1",
        name: "test_submission",
        arguments: { formId: "f1" },
      }),
    ).rejects.toThrow("confirmation");
    expect(
      await service.call({
        token: issued.token,
        workspaceId: "w1",
        name: "test_submission",
        arguments: {
          formId: "f1",
          fields: { email: "test@example.test" },
          confirm: true,
          idempotencyKey: "test-1234",
        },
      }),
    ).toMatchObject({ synthetic: true, externalSideEffectsSuppressed: true });
  });
});
