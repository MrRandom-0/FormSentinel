import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFile(new URL(path, root), "utf8");
describe("static accessibility semantics", () => {
  it("has a document language, main landmark, heading hierarchy, and labeled theme control", async () => {
    const [layout, home, toggle] = await Promise.all([
      read("apps/web/src/app/layout.tsx"),
      read("apps/web/src/app/page.tsx"),
      read("apps/web/src/components/ThemeToggle.tsx"),
    ]);
    expect(layout).toContain('<html lang="en"');
    expect(layout).toMatch(/<main[ >]/);
    expect(home).toMatch(/<h1[ >]/);
    expect(toggle).toMatch(/aria-label/);
  });
  it("records that browser accessibility remains unverified", async () =>
    expect(await read("docs/phase-4-launch.md")).toContain("Browser accessibility: unverified"));
});
