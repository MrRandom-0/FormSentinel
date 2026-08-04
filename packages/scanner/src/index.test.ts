import { createServer } from "node:http";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  NodePinnedScannerTransport,
  scanStaticHtml,
  type ScannerTransport,
  type ScannerTransportRequest,
} from "./index";
const actual = {
  endpoint: "https://ingest.example/v1/forms/fs/submissions",
  fields: [{ name: "email", type: "email", required: true }],
  allowedOrigins: ["https://site.example"],
};
const dns = async () => ["93.184.216.34"];
const transport = (
  request: (input: ScannerTransportRequest) => Promise<Response>,
): ScannerTransport => ({ request });
describe("static scanner", () => {
  it("passes only validated addresses to an injectable transport", async () => {
    const request = vi.fn(
      async (_input: ScannerTransportRequest) =>
        new Response('<div id="root"></div><script src="app.js"></script>', {
          headers: { "content-type": "text/html" },
        }),
    );
    const result = await scanStaticHtml(
      "https://example.com",
      { actual },
      { transport: transport(request), resolveDns: dns },
    );
    expect(result.status).toBe("browser_unavailable");
    expect(request.mock.calls[0]?.[0].approvedAddresses).toEqual(["93.184.216.34"]);
  });
  it("revalidates redirect DNS and rejects private destinations", async () => {
    const request = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://internal.example/x", "content-type": "text/html" },
        }),
    );
    const resolveDns = async (hostname: string) =>
      hostname === "internal.example" ? ["127.0.0.1"] : ["93.184.216.34"];
    await expect(
      scanStaticHtml(
        "https://example.com",
        { actual },
        { transport: transport(request), resolveDns },
      ),
    ).rejects.toThrow("unsafe_address");
  });
  it("rejects a genuine connection when DNS changes after validation", async () => {
    let connections = 0;
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end("<form></form>");
    });
    server.on("connection", () => {
      connections += 1;
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test_server_unavailable");
    const answers = [["93.184.216.34"], ["127.0.0.1"]] as const;
    let lookups = 0;
    const changingDns = async () => answers[Math.min(lookups++, answers.length - 1)]!;
    const pinned = new NodePinnedScannerTransport(async () => (await changingDns())[0]!);
    try {
      await expect(
        scanStaticHtml(
          `http://changing.example:${address.port}`,
          { actual },
          { transport: pinned, resolveDns: changingDns },
        ),
      ).rejects.toThrow("scanner_peer_mismatch");
      expect(lookups).toBe(2);
      expect(connections).toBe(1);
    } finally {
      server.close();
      await once(server, "close");
    }
  });
  it("enforces decompressed byte limit", async () => {
    const request = vi.fn(
      async () => new Response("x".repeat(100), { headers: { "content-type": "text/html" } }),
    );
    await expect(
      scanStaticHtml(
        "https://example.com",
        { actual, limits: { maxBytes: 10 } },
        { transport: transport(request), resolveDns: dns },
      ),
    ).rejects.toThrow("response_too_large");
  });
});
