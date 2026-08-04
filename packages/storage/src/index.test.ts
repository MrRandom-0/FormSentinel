import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DevelopmentEicarScanner,
  inspectFile,
  LocalPrivateStorage,
  UnavailableMalwareScanner,
} from "./index";
const dirs: string[] = [];
afterEach(async () =>
  Promise.all(dirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))),
);
describe("private file handling", () => {
  it("detects magic bytes and MIME mismatch", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(inspectFile("document.pdf", "application/pdf", pdf).accepted).toBe(true);
    expect(inspectFile("document.pdf", "image/png", pdf).reason).toBe("type_mismatch");
  });
  it("rejects double and dangerous extensions", () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    expect(inspectFile("invoice.exe.pdf", "application/pdf", pdf).reason).toBe("double_extension");
    expect(inspectFile("payload.exe", "application/octet-stream", pdf).reason).toBe(
      "extension_not_allowed",
    );
  });
  it("detects EICAR and represents unavailable scanning honestly", async () => {
    const bytes = new TextEncoder().encode(
      "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
    );
    expect((await new DevelopmentEicarScanner("test").scan(bytes)).status).toBe("infected");
    expect((await new UnavailableMalwareScanner().scan(bytes)).status).toBe("unavailable");
  });
  it("stores privately and refuses production local storage", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fs-storage-"));
    dirs.push(dir);
    const storage = new LocalPrivateStorage(dir, "test");
    const stored = await storage.putQuarantined("quarantine/a", new Uint8Array([1, 2]));
    expect(stored.byteSize).toBe(2);
    expect(await storage.readAuthorized(stored.key)).toEqual(new Uint8Array([1, 2]));
    expect(() => new LocalPrivateStorage(dir, "production")).toThrow();
  });
});
