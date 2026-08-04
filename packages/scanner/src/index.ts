import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import {
  analyzeIntegration,
  buildRepairPrompt,
  type ActualFormConfiguration,
  type IntegrationAnalysis,
} from "@formsentinel/integration-copilot";
import { validateNetworkUrl, type DnsResolver } from "@formsentinel/network-policy";
export interface ScannerLimits {
  maxRedirects: number;
  maxBytes: number;
  timeoutMs: number;
  maxHeaderBytes: number;
}
export interface ScannerTransportRequest {
  url: URL;
  approvedAddresses: readonly string[];
  signal: AbortSignal;
  headers: Readonly<Record<string, string>>;
}
export interface ScannerTransport {
  request(input: ScannerTransportRequest): Promise<Response>;
}
export interface ScanDependencies {
  transport: ScannerTransport;
  resolveDns: DnsResolver;
  now?: () => Date;
}
export interface StaticScanResult {
  requestedUrl: string;
  finalUrl: string;
  status: "complete" | "browser_unavailable";
  httpStatus: number;
  analysis: IntegrationAnalysis;
  repairPrompt: string;
  evidence: readonly { url: string; status: number }[];
}
export interface StaticScanOptions {
  actual: ActualFormConfiguration;
  limits?: Partial<ScannerLimits>;
  platform?: "Lovable" | "Bolt" | "v0" | "Cursor" | "Claude Code" | "Replit" | "Windsurf";
}
const defaults: ScannerLimits = {
  maxRedirects: 3,
  maxBytes: 1_000_000,
  timeoutMs: 10_000,
  maxHeaderBytes: 32_768,
};
export const systemDnsResolver: DnsResolver = async (hostname) =>
  (await lookup(hostname, { all: true, verbatim: true })).map((entry) => entry.address);
const normalizedAddress = (address: string) =>
  address
    .toLowerCase()
    .replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/, "")
    .split("%")[0]!;
export class NodePinnedScannerTransport implements ScannerTransport {
  constructor(
    private readonly dialAddress: (
      input: Readonly<{ url: URL; approvedAddress: string }>,
    ) => string | Promise<string> = ({ approvedAddress }) => approvedAddress,
  ) {}
  async request(input: ScannerTransportRequest): Promise<Response> {
    const approvedAddress = input.approvedAddresses[0];
    if (!approvedAddress) throw new Error("scanner_transport_unavailable");
    const connectionAddress = await this.dialAddress({ url: input.url, approvedAddress });
    return new Promise<Response>((resolve, reject) => {
      let peerVerified = false;
      const request = (input.url.protocol === "https:" ? httpsRequest : httpRequest)(
        {
          protocol: input.url.protocol,
          hostname: connectionAddress,
          port: input.url.port || (input.url.protocol === "https:" ? 443 : 80),
          path: `${input.url.pathname}${input.url.search}`,
          method: "GET",
          headers: { ...input.headers, host: input.url.host },
          servername: input.url.hostname,
          family: isIP(connectionAddress) || undefined,
          signal: input.signal,
          agent: false,
        },
        (incoming) => {
          if (!peerVerified) {
            incoming.destroy(new Error("scanner_peer_mismatch"));
            return;
          }
          const headers = new Headers();
          for (const [name, value] of Object.entries(incoming.headers))
            if (value !== undefined)
              headers.set(name, Array.isArray(value) ? value.join(", ") : value);
          resolve(
            new Response(Readable.toWeb(incoming) as ReadableStream<Uint8Array>, {
              status: incoming.statusCode ?? 500,
              ...(incoming.statusMessage ? { statusText: incoming.statusMessage } : {}),
              headers,
            }),
          );
        },
      );
      request.once("error", reject);
      request.once("socket", (socket) => {
        const event = input.url.protocol === "https:" ? "secureConnect" : "connect";
        socket.once(event, () => {
          const peer = socket.remoteAddress ? normalizedAddress(socket.remoteAddress) : "";
          peerVerified = input.approvedAddresses.some(
            (address) => normalizedAddress(address) === peer,
          );
          if (!peerVerified) request.destroy(new Error("scanner_peer_mismatch"));
        });
      });
      request.end();
    });
  }
}
export const nodePinnedScannerTransport = new NodePinnedScannerTransport();
function headerBytes(headers: Headers): number {
  let total = 0;
  headers.forEach((value, name) => {
    total += name.length + value.length + 4;
  });
  return total;
}
async function boundedText(response: Response, maximum: number): Promise<string> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maximum) throw new Error("response_too_large");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maximum) {
        await reader.cancel();
        throw new Error("response_too_large");
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}
export async function scanStaticHtml(
  urlValue: string,
  options: StaticScanOptions,
  dependencies: Partial<ScanDependencies> = {},
): Promise<StaticScanResult> {
  const limits = { ...defaults, ...options.limits };
  const transport = dependencies.transport ?? nodePinnedScannerTransport;
  const resolver = dependencies.resolveDns ?? systemDnsResolver;
  let validated = await validateNetworkUrl(urlValue, resolver);
  let current = validated.url;
  const evidence: { url: string; status: number }[] = [];
  let response: Response | null = null;
  for (let hop = 0; hop <= limits.maxRedirects; hop += 1) {
    response = await transport.request({
      url: current,
      approvedAddresses: validated.addresses,
      signal: AbortSignal.timeout(limits.timeoutMs),
      headers: {
        accept: "text/html,application/xhtml+xml",
        "accept-encoding": "identity",
        "user-agent": "FormSentinel-StaticScanner/0.3",
      },
    });
    evidence.push({ url: current.href, status: response.status });
    if (headerBytes(response.headers) > limits.maxHeaderBytes) throw new Error("headers_too_large");
    if (![301, 302, 303, 307, 308].includes(response.status)) break;
    if (hop === limits.maxRedirects) throw new Error("too_many_redirects");
    const location = response.headers.get("location");
    if (!location) throw new Error("redirect_missing_location");
    await response.body?.cancel();
    validated = await validateNetworkUrl(new URL(location, current).href, resolver);
    current = validated.url;
  }
  if (!response) throw new Error("scan_failed");
  const type = (response.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase();
  if (type !== "text/html" && type !== "application/xhtml+xml")
    throw new Error("unsupported_content_type");
  const source = await boundedText(response, limits.maxBytes);
  const analysis = analyzeIntegration(source, "html", options.actual);
  const jsOnly =
    analysis.forms.length === 0 && /<script\b|id=["'](?:root|app|__next)["']/i.test(source);
  return {
    requestedUrl: urlValue,
    finalUrl: current.href,
    status: jsOnly ? "browser_unavailable" : "complete",
    httpStatus: response.status,
    analysis,
    evidence,
    repairPrompt: buildRepairPrompt({
      platform: options.platform ?? "Cursor",
      analysis,
      actual: options.actual,
      files: [current.pathname || "index.html"],
      provenance: `static-scan:${current.href}`,
      version: "3",
    }),
  };
}
