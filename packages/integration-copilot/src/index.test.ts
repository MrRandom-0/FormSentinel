import { describe, expect, it } from "vitest";
import { analyzeIntegration, buildRepairPrompt, minimalUnifiedPatch } from "./index";
describe("integration copilot", () => {
  it("parses without executing source and compares actual configuration", () => {
    (globalThis as { __executed?: boolean }).__executed = false;
    const source = `<form action="/wrong"><label for="email">Email</label><input id="email" name="email" required><button>Send</button></form><script>globalThis.__executed=true</script>`;
    const actual = {
      endpoint: "https://ingest.example/v1/forms/fs/submissions",
      fields: [{ name: "email", type: "email", required: true }],
      allowedOrigins: ["https://site.example"],
    };
    const result = analyzeIntegration(source, "html", actual);
    expect((globalThis as { __executed?: boolean }).__executed).toBe(false);
    expect(result.findings.map((item) => item.code)).toEqual(
      expect.arrayContaining(["method_not_post", "endpoint_mismatch"]),
    );
    expect(minimalUnifiedPatch("index.html", source, result, actual)).toContain(actual.endpoint);
    expect(
      buildRepairPrompt({
        platform: "Cursor",
        analysis: result,
        actual,
        files: ["index.html"],
        provenance: "test",
      }),
    ).toContain("Lexical heuristic observations");
  });
  it("ignores forms and state words in comments, strings, and templates", () => {
    const source = `
      // <form><input name="fake"></form> success
      const html = '<form><input name="fake"></form>';
      const template = \`<form><input name="fake"></form> error\`;
      export const App = () => <section>Ready</section>;
    `;
    const result = analyzeIntegration(source, "tsx");
    expect(result.forms).toHaveLength(0);
    expect(result.states).toEqual({ loading: false, success: false, error: false });
    expect(result.analysisMethod).toBe("lexical_heuristic");
    expect(result.unsupportedCoverage).toContain("runtime behavior");
  });
  it("finds direct nested JSX but rejects malformed syntax explicitly", () => {
    const jsx = analyzeIntegration(
      `const App = () => <main><form method="post" action="/x"><input name="email" /><button>Send</button></form></main>`,
      "tsx",
    );
    expect(jsx.forms).toHaveLength(1);
    expect(jsx.forms[0]?.fields[0]?.name).toBe("email");
    expect(analyzeIntegration("const App = () => (<form>", "tsx").supported).toBe(false);
  });
  it("returns an explicit unsupported finding", () =>
    expect(analyzeIntegration("@sealed class A {}", "typescript").findings[0]?.code).toBe(
      "unsupported_syntax",
    ));
});
