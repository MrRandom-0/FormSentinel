import { once } from "node:events";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
const directories: string[] = [];
afterEach(async () =>
  Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  ),
);
describe("MCP executable", () => {
  it("starts a listening HTTP process when MCP_PORT is configured", async () => {
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const address = reservation.address();
    if (!address || typeof address === "string") throw new Error("port_unavailable");
    const port = address.port;
    reservation.close();
    await once(reservation, "close");
    const directory = await mkdtemp(join(tmpdir(), "formsentinel-mcp-"));
    directories.push(directory);
    const child = spawn("pnpm", ["exec", "tsx", "apps/mcp/src/index.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "development",
        MCP_PORT: String(port),
        FORMSENTINEL_LOCAL_DATA_FILE: join(directory, "data.json"),
      },
      stdio: "pipe",
    });
    try {
      let response: Response | undefined;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        try {
          response = await fetch(`http://127.0.0.1:${port}/health`);
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
      expect(response?.status).toBe(200);
      expect(await response?.json()).toMatchObject({ status: "ok", service: "mcp" });
    } finally {
      child.kill("SIGTERM");
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 2_000)),
      ]);
    }
  }, 20_000);
});
