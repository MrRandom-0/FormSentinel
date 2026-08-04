import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { lookup as nodeLookup } from "node:dns/promises";
export interface WebhookEnvelope {
  id: string;
  type: string;
  createdAt: string;
  data: unknown;
  version?: "2025-01-01";
}
export function signWebhook(payload: string, secret: string, timestamp: number): string {
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex")}`;
}
export function verifyWebhook(
  payload: string,
  signature: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
  toleranceSeconds = 300,
): boolean {
  const match = /^t=(\d+),v1=([a-f0-9]{64})$/.exec(signature);
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (Math.abs(now - timestamp) > toleranceSeconds) return false;
  const expected = signWebhook(payload, secret, timestamp);
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
export interface WebhookTransport {
  deliver(
    url: string,
    body: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<{ status: number; state?: "captured_local" | "delivered" }>;
}
export type DnsResolver = (hostname: string) => Promise<readonly string[]>;
const unsafeV4 = (value: string) => {
  const octets = value.split(".").map(Number);
  const [a = 0, b = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224
  );
};
export function isUnsafeAddress(address: string): boolean {
  let normalized = address.toLowerCase().split("%")[0] ?? address.toLowerCase();
  if (isIP(normalized) === 6) {
    try {
      const hostname = new URL(`http://[${normalized}]/`).hostname;
      normalized = hostname.slice(1, -1);
    } catch {
      return true;
    }
  }
  if (normalized.startsWith("::ffff:")) return isUnsafeAddress(normalized.slice(7));
  if (isIP(normalized) === 4) return unsafeV4(normalized);
  if (isIP(normalized) !== 6) return true;
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("64:ff9b:1:") ||
    normalized.startsWith("100:") ||
    normalized.startsWith("2001:2:") ||
    normalized.startsWith("2001:db8:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) ||
    normalized.startsWith("ff")
  );
}
export async function validateWebhookDestination(
  raw: string,
  resolveDns: DnsResolver,
  production = true,
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Invalid webhook URL.");
  }
  if (url.username || url.password) throw new Error("Webhook URL credentials are forbidden.");
  if (
    (production && url.protocol !== "https:") ||
    (!production && !["http:", "https:"].includes(url.protocol))
  )
    throw new Error("Unsafe webhook protocol.");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (![80, 443, 8443].includes(port)) throw new Error("Unsafe webhook port.");
  if (["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase()))
    throw new Error("Unsafe webhook destination.");
  const addresses = isIP(url.hostname) ? [url.hostname] : await resolveDns(url.hostname);
  if (!addresses.length || addresses.some(isUnsafeAddress))
    throw new Error("Unsafe webhook destination.");
  return url;
}
export class SafeWebhookTransport implements WebhookTransport {
  constructor(
    private readonly fetcher: typeof fetch = globalThis.fetch,
    private readonly resolver: DnsResolver = async (hostname) =>
      (await nodeLookup(hostname, { all: true })).map((entry) => entry.address),
    private readonly production = true,
  ) {}
  async deliver(
    raw: string,
    body: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<{ status: number; state: "delivered" }> {
    const url = await validateWebhookDestination(raw, this.resolver, this.production);
    const response = await this.fetcher(url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body,
      redirect: "error",
      signal: AbortSignal.timeout(5_000),
    });
    await response.body?.cancel();
    return { status: response.status, state: "delivered" };
  }
}
export class LocalCapturedWebhookTransport implements WebhookTransport {
  readonly captures: { url: string; body: string; headers: Readonly<Record<string, string>> }[] =
    [];
  async deliver(
    url: string,
    body: string,
    headers: Readonly<Record<string, string>>,
  ): Promise<{ status: number; state: "captured_local" }> {
    this.captures.push({ url, body, headers });
    return { status: 202, state: "captured_local" };
  }
}
