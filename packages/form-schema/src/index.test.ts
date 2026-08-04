import { describe, expect, it } from "vitest";
import { formDefinition, validateSubmission } from "./index";
describe("form definition", () => {
  it("accepts typed unique fields", () => {
    expect(
      formDefinition.parse({
        fields: [{ name: "email", label: "Email", type: "email", required: true }],
      }).fields,
    ).toHaveLength(1);
  });
  it("rejects duplicate or unsafe field names", () => {
    expect(() =>
      formDefinition.parse({ fields: [{ name: "bad name", label: "Bad", type: "text" }] }),
    ).toThrow();
    expect(() =>
      formDefinition.parse({
        fields: [
          { name: "email", label: "One", type: "email" },
          { name: "email", label: "Two", type: "email" },
        ],
      }),
    ).toThrow();
  });
});

describe("submission validation", () => {
  const fields = [
    { name: "email", type: "email" as const, required: true },
    { name: "site", type: "url" as const, required: false },
    { name: "count", type: "number" as const, required: false },
    { name: "consent", type: "checkbox" as const, required: true },
  ];

  it("normalizes valid browser values", () => {
    expect(
      validateSubmission(fields, {
        email: "person@example.test",
        site: "https://example.test/path",
        count: "3",
        consent: "on",
      }),
    ).toEqual({
      success: true,
      data: {
        email: "person@example.test",
        site: "https://example.test/path",
        count: 3,
        consent: true,
      },
    });
  });

  it.each([
    [{ email: "invalid", consent: true }, "email"],
    [{ email: "person@example.test", site: "ftp://example.test", consent: true }, "site"],
    [{ email: "person@example.test", count: "three", consent: true }, "count"],
    [{ email: "person@example.test", consent: "yes" }, "consent"],
    [{ consent: true }, "email"],
    [{ email: "person@example.test", consent: true, extra: "value" }, "extra"],
  ])("rejects invalid, missing, and unknown values", (input, field) => {
    const result = validateSubmission(fields, input);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.errors[field]).toBeDefined();
  });

  it("rejects non-object roots", () => {
    expect(validateSubmission(fields, [])).toMatchObject({ success: false });
    expect(validateSubmission(fields, "value")).toMatchObject({ success: false });
  });
});
