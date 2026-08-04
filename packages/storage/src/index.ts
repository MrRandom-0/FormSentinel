import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";

export interface StoredObject {
  key: string;
  byteSize: number;
  checksumSha256: string;
}
export interface PrivateStorage {
  putQuarantined(key: string, bytes: Uint8Array): Promise<StoredObject>;
  readAuthorized(key: string): Promise<Uint8Array>;
  delete(key: string): Promise<void>;
}
export interface ObjectStorage extends PrivateStorage {
  createAuthorizedDownload(key: string, expiresInSeconds: number): Promise<string>;
}

export class UnavailablePrivateStorage implements PrivateStorage {
  async putQuarantined(_key: string, _bytes: Uint8Array): Promise<StoredObject> {
    throw new Error("Private object storage provider is not configured.");
  }
  async readAuthorized(_key: string): Promise<Uint8Array> {
    throw new Error("Private object storage provider is not configured.");
  }
  async delete(_key: string): Promise<void> {
    throw new Error("Private object storage provider is not configured.");
  }
}

export class LocalPrivateStorage implements PrivateStorage {
  private readonly root: string;
  constructor(
    directory: string,
    environment: "development" | "test" | "production" = "development",
  ) {
    if (environment === "production")
      throw new Error("Local filesystem storage is disabled in production.");
    this.root = resolve(directory);
  }
  private path(key: string): string {
    const candidate = resolve(this.root, key);
    if (!candidate.startsWith(`${this.root}${sep}`)) throw new Error("Invalid storage key.");
    return candidate;
  }
  async putQuarantined(key: string, bytes: Uint8Array): Promise<StoredObject> {
    const path = this.path(key);
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, bytes, { mode: 0o600, flag: "wx" });
    return {
      key,
      byteSize: bytes.byteLength,
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }
  async readAuthorized(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.path(key)));
  }
  async delete(key: string): Promise<void> {
    const path = this.path(key);
    let handle;
    try {
      handle = await open(path, "r+");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
      throw error;
    }
    try {
      const { size } = await handle.stat();
      const zeros = new Uint8Array(Math.min(65_536, Math.max(1, size)));
      for (let position = 0; position < size; position += zeros.byteLength)
        await handle.write(zeros, 0, Math.min(zeros.byteLength, size - position), position);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rm(path, { force: true });
  }
}

export interface FileInspection {
  accepted: boolean;
  extension: string;
  detectedType: string | null;
  reason?: "extension_not_allowed" | "double_extension" | "type_mismatch" | "unsupported_type";
}
const signatures: readonly [string, readonly number[]][] = [
  ["application/pdf", [0x25, 0x50, 0x44, 0x46]],
  ["image/png", [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ["image/jpeg", [0xff, 0xd8, 0xff]],
  ["image/gif", [0x47, 0x49, 0x46, 0x38]],
  ["text/plain", []],
];
const dangerousExtensions = new Set([
  "exe",
  "js",
  "html",
  "htm",
  "svg",
  "php",
  "sh",
  "bat",
  "cmd",
  "com",
  "scr",
]);
export function inspectFile(
  filename: string,
  declaredType: string,
  bytes: Uint8Array,
  allowedExtensions: readonly string[] = ["pdf", "png", "jpg", "jpeg", "gif", "txt"],
): FileInspection {
  const clean = basename(filename).toLowerCase();
  const parts = clean.split(".");
  const extension = extname(clean).slice(1);
  if (!extension || !allowedExtensions.includes(extension))
    return { accepted: false, extension, detectedType: null, reason: "extension_not_allowed" };
  if (parts.slice(1, -1).some((part) => dangerousExtensions.has(part)))
    return { accepted: false, extension, detectedType: null, reason: "double_extension" };
  let detectedType: string | null = null;
  for (const [type, signature] of signatures) {
    if (signature.length && signature.every((value, index) => bytes[index] === value)) {
      detectedType = type;
      break;
    }
  }
  if (!detectedType && extension === "txt" && !bytes.subarray(0, 512).includes(0))
    detectedType = "text/plain";
  if (!detectedType)
    return { accepted: false, extension, detectedType, reason: "unsupported_type" };
  const declared = declaredType.toLowerCase().split(";")[0];
  const jpegAlias = ["jpg", "jpeg"].includes(extension) && detectedType === "image/jpeg";
  const expected =
    extension === "pdf"
      ? "application/pdf"
      : extension === "png"
        ? "image/png"
        : extension === "gif"
          ? "image/gif"
          : jpegAlias
            ? "image/jpeg"
            : "text/plain";
  if (declared !== expected || detectedType !== expected)
    return { accepted: false, extension, detectedType, reason: "type_mismatch" };
  return { accepted: true, extension, detectedType };
}
export function generatedStorageKey(workspaceId: string, formId: string): string {
  return `quarantine/${workspaceId}/${formId}/${randomUUID()}`;
}
export interface MalwareScanResult {
  status: "clean" | "infected" | "unavailable";
  signature?: string;
}
export interface MalwareScanner {
  scan(bytes: Uint8Array): Promise<MalwareScanResult>;
}
export class DevelopmentEicarScanner implements MalwareScanner {
  constructor(environment: "development" | "test" | "production") {
    if (environment === "production")
      throw new Error("Development malware scanner is forbidden in production.");
  }
  async scan(bytes: Uint8Array): Promise<MalwareScanResult> {
    const text = new TextDecoder().decode(bytes);
    return text.includes("EICAR-STANDARD-ANTIVIRUS-TEST-FILE")
      ? { status: "infected", signature: "EICAR-Test-File" }
      : { status: "clean" };
  }
}
export class UnavailableMalwareScanner implements MalwareScanner {
  async scan(_bytes: Uint8Array): Promise<MalwareScanResult> {
    return { status: "unavailable" };
  }
}
