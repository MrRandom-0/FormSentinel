import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDurableSubmissionStore, fingerprintPayload, safeCsvCell } from "./index";
const directories: string[] = [];
async function store() {
  const directory = await mkdtemp(join(tmpdir(), "fs-phase2-"));
  directories.push(directory);
  const file = join(directory, "data.json");
  await writeFile(
    file,
    JSON.stringify({
      memberships: [
        { userId: "user", workspaceId: "workspace", role: "owner" },
        { userId: "viewer", workspaceId: "workspace", role: "viewer" },
      ],
      forms: [
        {
          id: "form",
          workspaceId: "workspace",
          endpointKey: "fs_test",
          name: "Contact",
          active: true,
          fields: [{ name: "email", type: "email", required: true }],
          allowedOrigins: [],
        },
      ],
    }),
  );
  return new LocalDurableSubmissionStore(file, "test");
}
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);
const input = {
  requestId: "request-one",
  publicFormId: "fs_test",
  payload: { email: "person@example.test" },
  contentType: "application/json",
  payloadBytes: 10,
  sourceIpHash: "hash",
  userAgent: null,
  origin: null,
  referrer: null,
  utm: {},
  spamStatus: "allowed" as const,
  spamScore: 0,
  spamReasons: [],
  idempotencyKey: "key",
  requestFingerprint: fingerprintPayload({ email: "person@example.test" }),
};
describe("local durable submissions", () => {
  it("atomically accepts, replays, conflicts, deduplicates jobs, and leases", async () => {
    const local = await store();
    const accepted = await local.accept(input);
    expect(accepted.kind).toBe("accepted");
    expect((await local.accept({ ...input, requestId: "request-two" })).kind).toBe("replayed");
    expect(
      (
        await local.accept({
          ...input,
          requestId: "request-three",
          requestFingerprint: "different",
        })
      ).kind,
    ).toBe("conflict");
    const jobs = await local.claim("worker", 10, 1000);
    expect(jobs).toHaveLength(1);
    expect(await local.complete(jobs[0]!.id, "worker")).toBe(true);
  });
  it("recovers expired leases without exceeding max attempts", async () => {
    const local = await store();
    await local.accept(input);
    let now = new Date("2025-01-01T00:00:00Z");
    const first = await local.claim("one", 1, 10, now);
    for (let attempt = 1; attempt < 5; attempt += 1) {
      now = new Date(now.getTime() + 11);
      expect((await local.claim(`worker-${attempt}`, 1, 10, now))[0]?.id).toBe(first[0]?.id);
    }
    now = new Date(now.getTime() + 11);
    expect(await local.claim("too-many", 1, 10, now)).toHaveLength(0);
  });
  it("enforces tenant and role authorization", async () => {
    const local = await store();
    await expect(local.listSubmissions("other", "workspace")).rejects.toThrow(
      "Permission denied: submissions:read",
    );
    const accepted = await local.accept(input);
    if (accepted.kind === "conflict") throw new Error("expected accepted submission");
    await expect(local.listSubmissions("viewer", "workspace")).resolves.toBeDefined();
    await expect(
      local.updateSubmission("viewer", "workspace", accepted.submission.id, "resolve"),
    ).rejects.toThrow("Permission denied: submissions:update");
  });
  it("neutralizes spreadsheet formulas", () =>
    expect(safeCsvCell('=HYPERLINK("bad")')).toBe('"\'=HYPERLINK(""bad"")"'));
});
