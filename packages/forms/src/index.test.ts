import { describe, expect, it } from "vitest";
import {
  formConfigurationSchema,
  integrationCopilotPrompt,
  integrationSnippet,
  integrationSnippets,
  publicEndpoint,
} from "./index";

describe("integration configuration", () => {
  it("builds an opaque public endpoint", () => {
    expect(publicEndpoint("https://ingest.example/", "ep_123")).toBe(
      "https://ingest.example/v1/forms/ep_123/submissions",
    );
  });
  it("places actual endpoint and honeypot values in snippets", () => {
    const snippet = integrationSnippet("react", {
      endpoint: "https://i.test/v1/forms/abc/submissions",
      honeypotField: "fax",
    });
    expect(snippet).toContain("https://i.test/v1/forms/abc/submissions");
    expect(snippet).toContain('name="fax"');
  });
  it("renders actual textarea fields and honeypots across framework snippets", () => {
    const snippets = integrationSnippets({
      endpoint: "https://i.test/v1/forms/abc/submissions",
      honeypotField: "company_site",
      fields: [{ name: "message", type: "textarea", required: true }],
      allowedDomains: [],
    });
    expect(snippets.html).toContain('<textarea name="message" required>');
    expect(snippets.vue).toContain('name="company_site"');
    expect(snippets.svelte).toContain('name="company_site"');
  });
  it("builds a platform-specific copilot prompt from real configuration", () => {
    const prompt = integrationCopilotPrompt("lovable", {
      endpoint: "https://ingest.test/v1/forms/fs_real/submissions",
      fields: [{ name: "email", type: "email", required: true }],
      allowedDomains: ["https://site.test"],
      successRedirect: "https://site.test/thanks",
      honeypotField: "fax",
    });
    expect(prompt).toContain("existing Lovable form component");
    expect(prompt).toContain("https://ingest.test/v1/forms/fs_real/submissions");
    expect(prompt).toContain("https://site.test");
    expect(prompt).toContain("fax");
  });
  it("normalizes exact HTTP origins and rejects unsafe URLs", () => {
    const base = {
      name: "Contact",
      platform: "html",
      template: "contact",
      honeypotField: "fax",
      notificationEmail: "",
    };
    expect(
      formConfigurationSchema.parse({
        ...base,
        sourceUrl: "https://example.test/contact",
        successRedirect: "http://localhost:3000/thanks",
        allowedOrigins: ["https://EXAMPLE.test:443", "https://*.Example.test"],
      }).allowedOrigins,
    ).toEqual(["https://example.test", "https://*.example.test"]);
    for (const sourceUrl of ["javascript:alert(1)", "ftp://example.test/file"])
      expect(() =>
        formConfigurationSchema.parse({
          ...base,
          sourceUrl,
          successRedirect: "",
          allowedOrigins: [],
        }),
      ).toThrow();
    for (const origin of [
      "https://user:pass@example.test",
      "https://example.test/path",
      "https://example.test?query=1",
      "https://example.test#hash",
    ])
      expect(() =>
        formConfigurationSchema.parse({
          ...base,
          sourceUrl: "",
          successRedirect: "",
          allowedOrigins: [origin],
        }),
      ).toThrow();
  });
});
