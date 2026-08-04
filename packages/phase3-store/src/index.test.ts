import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalPhase3Store, LocalScopedTokenRepository } from "./index";
import { ScopedTokenService } from "@formsentinel/security";
const dirs: string[] = [];
afterEach(async () =>
  Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))),
);
describe("canonical Phase 3 store", () => {
  it("atomically scopes records and enforces immutable/optimistic versions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fs-p3-"));
    dirs.push(dir);
    const store = new LocalPhase3Store(join(dir, "data.json"), "test");
    const record = await store.create({
      kind: "scanner_run",
      workspaceId: "w1",
      data: { status: "pending" },
    });
    expect(await store.get("w2", "scanner_run", record.id)).toBeNull();
    const updated = await store.update("w1", "scanner_run", record.id, 1, { status: "done" });
    expect(updated.version).toBe(2);
    await expect(store.update("w1", "scanner_run", record.id, 1, { status: "x" })).rejects.toThrow(
      "optimistic_lock_failed",
    );
    const snapshot = await store.create({
      kind: "schema_version",
      workspaceId: "w1",
      data: { fields: [] },
      immutable: true,
    });
    await expect(
      store.update("w1", "schema_version", snapshot.id, 1, { fields: [] }),
    ).rejects.toThrow("immutable_record");
  });
  it("queues IDs only with dedupe, leases and dead letters", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fs-p3-"));
    dirs.push(dir);
    const store = new LocalPhase3Store(join(dir, "data.json"), "test");
    const first = await store.enqueue("scan", "scan.run", { scanRunId: "r1" }, "r1", new Date(), 1);
    expect((await store.enqueue("scan", "scan.run", { scanRunId: "r1" }, "r1")).id).toBe(first.id);
    await expect(store.enqueue("scan", "bad", { source: "body" }, "bad")).rejects.toThrow(
      "ids_only",
    );
    const jobs = await store.claim("scan", "owner", 1, 1000);
    expect(jobs).toHaveLength(1);
    expect(await store.fail(jobs[0]!.id, "owner", "failed")).toBe("dead_letter");
  });
  it("durably stores only scoped token hashes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fs-p3-"));
    dirs.push(dir);
    const store = new LocalPhase3Store(join(dir, "data.json"), "test");
    const service = new ScopedTokenService(
      new LocalScopedTokenRepository(store),
      "durable-token-hash-secret",
    );
    const issued = await service.issue({
      workspaceId: "w1",
      scopes: ["forms:read"],
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect((await store.list("w1", "scoped_token"))[0]?.data).not.toEqual(
      expect.objectContaining({ token: issued.token }),
    );
    expect(
      await service.authorize(issued.token, { workspaceId: "w1", scope: "forms:read" }),
    ).toBeTruthy();
  });
  it("refuses production", () => expect(() => new LocalPhase3Store("x", "production")).toThrow());
});
