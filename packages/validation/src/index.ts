import { z } from "zod";
export const emailAddress = z.string().trim().toLowerCase().email();
export const safeUrl = z
  .string()
  .url()
  .refine(
    (value) => ["http:", "https:"].includes(new URL(value).protocol),
    "Only HTTP(S) URLs are allowed",
  );
export const opaqueId = z
  .string()
  .min(20)
  .max(100)
  .regex(/^[A-Za-z0-9_-]+$/);
export function parseFormData<T extends z.ZodType>(schema: T, data: FormData): z.infer<T> {
  return schema.parse(Object.fromEntries(data));
}
