import { z } from "zod";

export const fieldType = z.enum(["text", "email", "textarea", "tel", "url", "number", "checkbox"]);
export const fieldDefinition = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9_-]*$/),
  label: z.string().trim().min(1).max(100),
  type: fieldType,
  required: z.boolean().default(false),
});
export const formDefinition = z
  .object({ fields: z.array(fieldDefinition).min(1).max(50) })
  .superRefine(({ fields }, context) => {
    const seen = new Set<string>();
    fields.forEach((field, index) => {
      if (seen.has(field.name))
        context.addIssue({
          code: "custom",
          path: ["fields", index, "name"],
          message: "Field names must be unique",
        });
      seen.add(field.name);
    });
  });
export type FormDefinition = z.infer<typeof formDefinition>;
export type SubmissionField = Pick<FormDefinition["fields"][number], "name" | "type" | "required">;

export type SubmissionValidationResult =
  | { success: true; data: Record<string, string | number | boolean> }
  | { success: false; errors: Record<string, string> };

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function validateSubmission(
  fields: readonly SubmissionField[],
  input: unknown,
): SubmissionValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return { success: false, errors: { root: "Submission must be a JSON object or form body" } };

  const payload = input as Record<string, unknown>;
  const expected = new Set(fields.map((field) => field.name));
  const errors: Record<string, string> = {};
  const data: Record<string, string | number | boolean> = {};

  for (const name of Object.keys(payload)) if (!expected.has(name)) errors[name] = "Unknown field";

  for (const field of fields) {
    const value = payload[field.name];
    const missing = value === undefined || value === null || value === "";
    if (missing) {
      if (field.required) errors[field.name] = "Required field";
      continue;
    }

    if (field.type === "checkbox") {
      const normalized =
        value === "on" || value === "true" ? true : value === "false" ? false : value;
      if (typeof normalized !== "boolean") errors[field.name] = "Must be a checkbox value";
      else if (field.required && !normalized)
        errors[field.name] = "Required checkbox must be checked";
      else data[field.name] = normalized;
      continue;
    }

    if (field.type === "number") {
      const normalized = typeof value === "string" && value.trim() ? Number(value) : value;
      if (typeof normalized !== "number" || !Number.isFinite(normalized))
        errors[field.name] = "Must be a valid number";
      else data[field.name] = normalized;
      continue;
    }

    if (typeof value !== "string") {
      errors[field.name] = `Must be a valid ${field.type}`;
      continue;
    }
    if (field.type === "email" && !z.email().safeParse(value).success)
      errors[field.name] = "Must be a valid email address";
    else if (field.type === "url" && !isHttpUrl(value))
      errors[field.name] = "Must be a valid HTTP(S) URL";
    else data[field.name] = value;
  }

  return Object.keys(errors).length ? { success: false, errors } : { success: true, data };
}
