import { describe, expect, it } from "vitest";
import { ApiKeyService, MemoryApiKeyRepository } from "./index";
const secret = "independent-api-key-secret-material-123";
describe("API keys", () => {
  it("shows plaintext once and stores only a hash", async () => {
    const repository = new MemoryApiKeyRepository("test");
    const service = new ApiKeyService(repository, secret);
    const issued = await service.issue({
      workspaceId: "w1",
      name: "automation",
      scopes: ["submissions:read"],
      formGrants: ["f1"],
      actorId: "u1",
    });
    expect(issued.token).toMatch(/^fsapi_/);
    expect(JSON.stringify([...repository.records.values()])).not.toContain(issued.token);
    await expect(
      service.authorize(issued.token, {
        workspaceId: "w1",
        scope: "submissions:read",
        formId: "f1",
      }),
    ).resolves.toBeDefined();
    await expect(
      service.authorize(issued.token, { workspaceId: "w2", scope: "submissions:read" }),
    ).rejects.toThrow("invalid_api_key");
  });
  it("keeps MCP credentials distinct and enforces scopes", async () => {
    const service = new ApiKeyService(new MemoryApiKeyRepository("test"), secret);
    const issued = await service.issue({
      workspaceId: "w",
      name: "read",
      scopes: ["forms:read"],
      actorId: "u",
    });
    await expect(
      service.authorize("fsmcp_not_an_api_key", { workspaceId: "w", scope: "forms:read" }),
    ).rejects.toThrow("credential_type");
    await expect(
      service.authorize(issued.token, { workspaceId: "w", scope: "submissions:write" }),
    ).rejects.toThrow("forbidden");
  });
  it("rotates and revokes durably", async () => {
    const repository = new MemoryApiKeyRepository("test");
    const service = new ApiKeyService(repository, secret);
    const first = await service.issue({
      workspaceId: "w",
      name: "first",
      scopes: ["forms:read"],
      actorId: "u",
    });
    const second = await service.rotate("w", first.record.id, {
      name: "second",
      scopes: ["forms:read"],
      actorId: "u",
    });
    await expect(
      service.authorize(first.token, { workspaceId: "w", scope: "forms:read" }),
    ).rejects.toThrow("invalid_api_key");
    await expect(
      service.authorize(second.token, { workspaceId: "w", scope: "forms:read" }),
    ).resolves.toBeDefined();
  });
});
