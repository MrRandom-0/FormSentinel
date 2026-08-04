import { isIP } from "node:net";
export type DnsResolver = (hostname: string) => Promise<readonly string[]>;
const forbiddenPorts = new Set([
  0, 1, 7, 9, 19, 22, 23, 25, 53, 69, 111, 135, 137, 138, 139, 445, 512, 513, 514, 2049, 2375, 3306,
  5432, 6379, 11211,
]);
function ipv4Number(address: string): number | null {
  if (isIP(address) !== 4) return null;
  const parts = address.split(".").map(Number);
  return (((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!) >>> 0;
}
const range = (value: number, start: number, bits: number) =>
  value >>> (32 - bits) === start >>> (32 - bits);
function ipv6Number(address: string): bigint | null {
  if (isIP(address) !== 6) return null;
  let normalized = address.toLowerCase().split("%")[0]!;
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(normalized);
  if (dotted) {
    const value = ipv4Number(dotted[1]!);
    if (value === null) return null;
    normalized = normalized.replace(
      dotted[1]!,
      `${((value >>> 16) & 0xffff).toString(16)}:${(value & 0xffff).toString(16)}`,
    );
  }
  const halves = normalized.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves[1] ? halves[1].split(":") : [];
  const groups =
    halves.length === 2
      ? [...left, ...Array.from({ length: 8 - left.length - right.length }, () => "0"), ...right]
      : left;
  if (groups.length !== 8) return null;
  return groups.reduce(
    (result, group) => (result << 16n) + BigInt(Number.parseInt(group || "0", 16)),
    0n,
  );
}
const ipv6Prefix = (value: bigint, start: string, bits: number) => {
  const startValue = ipv6Number(start)!;
  return value >> BigInt(128 - bits) === startValue >> BigInt(128 - bits);
};
export function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (!version) return false;
  if (version === 4) {
    const value = ipv4Number(address)!;
    const blocked: readonly [string, number][] = [
      ["0.0.0.0", 8],
      ["10.0.0.0", 8],
      ["100.64.0.0", 10],
      ["127.0.0.0", 8],
      ["169.254.0.0", 16],
      ["172.16.0.0", 12],
      ["192.0.0.0", 24],
      ["192.0.2.0", 24],
      ["192.168.0.0", 16],
      ["198.18.0.0", 15],
      ["198.51.100.0", 24],
      ["203.0.113.0", 24],
      ["224.0.0.0", 4],
      ["240.0.0.0", 4],
    ];
    return !blocked.some(([start, bits]) => range(value, ipv4Number(start)!, bits));
  }
  const normalized = address.toLowerCase().split("%")[0]!;
  const value = ipv6Number(normalized);
  if (value === null) return false;
  if (ipv6Prefix(value, "::ffff:0:0", 96)) {
    return isPublicAddress(
      String((value >> 24n) & 255n) +
        "." +
        String((value >> 16n) & 255n) +
        "." +
        String((value >> 8n) & 255n) +
        "." +
        String(value & 255n),
    );
  }
  const blocked: readonly [string, number][] = [
    ["::", 128],
    ["::1", 128],
    ["64:ff9b:1::", 48],
    ["100::", 64],
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["3fff::", 20],
    ["5f00::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
  ];
  return !blocked.some(([start, bits]) => ipv6Prefix(value, start, bits));
}
export async function validateNetworkUrl(
  value: string,
  resolveDns: DnsResolver,
): Promise<{ url: URL; addresses: readonly string[] }> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("invalid_url");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("unsupported_protocol");
  if (url.username || url.password) throw new Error("credentials_forbidden");
  const port = url.port ? Number(url.port) : url.protocol === "https:" ? 443 : 80;
  if (!Number.isInteger(port) || port < 1 || port > 65535 || forbiddenPorts.has(port))
    throw new Error("unsafe_port");
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "metadata.google.internal"
  )
    throw new Error("unsafe_hostname");
  const addresses = isIP(hostname) ? [hostname] : [...new Set(await resolveDns(hostname))];
  if (!addresses.length) throw new Error("dns_empty");
  if (addresses.some((address) => !isPublicAddress(address))) throw new Error("unsafe_address");
  return { url, addresses };
}
