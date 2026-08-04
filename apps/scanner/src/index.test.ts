import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalPhase3Store } from "@formsentinel/phase3-store";
import { createScannerServer } from "./index";
const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);
describe("scanner HTTP runtime", () => {
  it("authenticates, scans over HTTP, and persists run evidence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "formsentinel-scanner-"));
    directories.push(directory);
    const repository = new LocalPhase3Store(join(directory, "data.json"), "test");
    const server = createScannerServer({
      serviceToken: "scanner-test-token",
      repository,
      resolveDns: async () => ["93.184.216.34"],
      transport: {
        request: async () =>
          new Response('<form method="post" action="https://ingest.example/f1"></form>', {
            headers: { "content-type": "text/html" },
          }),
      },
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server_unavailable");
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/v1/scans`, {
        method: "POST",
        headers: {
          authorization: "Bearer scanner-test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          workspaceId: "w1",
          formId: "f1",
          url: "https://site.example/contact",
          actual: {
            endpoint: "https://ingest.example/f1",
            fields: [],
            allowedOrigins: ["https://site.example"],
          },
        }),
      });
      expect(response.status).toBe(200);
      const result = (await response.json()) as { scanRunId: string };
      expect(await repository.get("w1", "scanner_run", result.scanRunId)).toMatchObject({
        data: { status: "complete" },
      });
      expect(await repository.list("w1", "scanner_evidence", "f1")).toHaveLength(1);
    } finally {
      server.close();
      await once(server, "close");
    }
  });
});
