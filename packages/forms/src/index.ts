import { z } from "zod";

const httpUrl = z
  .string()
  .url()
  .superRefine((value, context) => {
    const url = new URL(value);
    if (!(["http:", "https:"] as string[]).includes(url.protocol))
      context.addIssue({ code: "custom", message: "URL must use HTTP or HTTPS" });
    if (url.username || url.password)
      context.addIssue({ code: "custom", message: "URL must not include credentials" });
  });

const allowedOrigin = z
  .string()
  .superRefine((value, context) => {
    const wildcard = /^https?:\/\/\*\./.test(value);
    if (value.includes("*") && !wildcard)
      context.addIssue({ code: "custom", message: "Wildcard must be the left-most host label" });
    let url: URL;
    try {
      url = new URL(wildcard ? value.replace("://*.", "://wildcard.") : value);
    } catch {
      context.addIssue({ code: "custom", message: "Origin must be a valid HTTP(S) URL" });
      return;
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
      context.addIssue({ code: "custom", message: "Origin must use HTTP(S) without credentials" });
    if (url.pathname !== "/" || url.search || url.hash)
      context.addIssue({
        code: "custom",
        message: "Origin must not include a path, query, or hash",
      });
  })
  .transform((value) => {
    const wildcard = /^https?:\/\/\*\./.test(value);
    const origin = new URL(wildcard ? value.replace("://*.", "://wildcard.") : value).origin;
    return wildcard ? origin.replace("://wildcard.", "://*.") : origin;
  });

export const formConfigurationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  platform: z.string().min(1),
  template: z.string().min(1),
  sourceUrl: httpUrl.optional().or(z.literal("")),
  successRedirect: httpUrl.optional().or(z.literal("")),
  allowedOrigins: z.array(allowedOrigin).max(10).default([]),
  honeypotField: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
    .default("company_website"),
  notificationEmail: z.string().email().optional().or(z.literal("")),
});
export type FormConfiguration = z.infer<typeof formConfigurationSchema>;
export const integrationPlatforms = [
  "lovable",
  "bolt",
  "v0",
  "cursor",
  "claude-code",
  "replit",
  "windsurf",
  "framer",
  "webflow",
  "react",
  "nextjs",
  "vue",
  "svelte",
  "astro",
  "html",
] as const;
export type IntegrationPlatform = (typeof integrationPlatforms)[number];
export interface PromptConfiguration {
  endpoint: string;
  fields: readonly { name: string; type: string; required: boolean }[];
  allowedDomains: readonly string[];
  successRedirect?: string | null;
  honeypotField: string;
}

export function publicEndpoint(origin: string, publicFormId: string): string {
  return `${origin.replace(/\/$/, "")}/v1/forms/${publicFormId}/submissions`;
}

const platformGuidance: Record<IntegrationPlatform, string> = {
  lovable:
    "Update the existing Lovable form component without replacing its visual design. Use its React event handler and show inline state.",
  bolt: "In the Bolt project, update the existing framework component and preserve the generated styling and routes.",
  v0: "Update the v0 React/Next.js component, keeping shadcn/ui semantics and server/client boundaries correct.",
  cursor:
    "Inspect the repository in Cursor, identify the current form framework, and make the smallest typed implementation change.",
  "claude-code":
    "Inspect the repository with Claude Code before editing. Follow its conventions and verify with the existing test/build scripts.",
  replit:
    "Update the Replit app's existing form and keep secrets server-side; use its configured run and deployment commands.",
  windsurf:
    "Inspect the Windsurf workspace and existing form component, then implement within its framework and conventions.",
  framer:
    "Use a Framer code component or fetch override; preserve Framer's visual form and publish-domain behavior.",
  webflow:
    "Use Webflow's form markup and a small custom submit script added before </body>; preserve native accessibility attributes.",
  react:
    "Implement this in the existing React form with controlled pending, success, and error states.",
  nextjs:
    "Use the existing Next.js App Router component. Add 'use client' only where submission state requires it.",
  vue: "Implement in the existing Vue component using refs for pending/error/success state and @submit.prevent.",
  svelte:
    "Implement in the existing Svelte component with an on:submit handler and reactive status messaging.",
  astro:
    "Keep the form as Astro HTML where possible and add a small client script for progressive enhancement.",
  html: "Use standards-based HTML and a small progressive-enhancement script; the form must still have labels and native validation.",
};

export function integrationCopilotPrompt(
  platform: IntegrationPlatform,
  configuration: PromptConfiguration,
): string {
  const fields = configuration.fields
    .map((field) => `- ${field.name}: ${field.type}${field.required ? ", required" : ", optional"}`)
    .join("\n");
  const domains = configuration.allowedDomains.length
    ? configuration.allowedDomains.join(", ")
    : "No domain restriction is configured for development";
  return `Integrate this FormSentinel development endpoint into my ${platform} project.\n\n${platformGuidance[platform]}\n\nActual configuration:\nEndpoint: ${configuration.endpoint}\nMethod: POST\nFields:\n${fields}\nHoneypot field: ${configuration.honeypotField} (must be visually hidden, unfocusable, and left empty)\nAllowed domains: ${domains}\nSuccess behavior: ${configuration.successRedirect ? `redirect to ${configuration.successRedirect}` : "show an accessible inline confirmation and reset the form"}\n\nRequirements:\n1. Submit JSON or FormData with exactly the configured field names. Never put secrets in browser code.\n2. Keep native labels, keyboard access, required attributes, focus management, and an aria-live status region.\n3. Disable duplicate submits while pending. Show actionable validation/network errors without claiming success.\n4. Do not bypass allowed-domain, honeypot, CSP, or browser security controls. Do not log personal submission values.\n5. Add a focused test covering successful submission, validation failure, and network failure.\n6. Test locally against the durable FormSentinel ingest service; no paid credential is required for local capture.\n7. Preserve the project's existing style and run its typecheck, tests, and production build before deploying.`;
}

export type SnippetPlatform =
  | "html"
  | "fetch"
  | "react"
  | "nextjs"
  | "next-server-action"
  | "vue"
  | "svelte"
  | "astro"
  | "framer"
  | "webflow";
export function integrationSnippets(
  configuration: PromptConfiguration,
): Record<SnippetPlatform, string> {
  const inputs = configuration.fields
    .map((field) =>
      field.type === "textarea"
        ? `  <label>${field.name} <textarea name="${field.name}"${field.required ? " required" : ""}></textarea></label>`
        : `  <label>${field.name} <input name="${field.name}" type="${field.type}"${field.required ? " required" : ""}></label>`,
    )
    .join("\n");
  const form = `<form id="contact" action="${configuration.endpoint}" method="post" enctype="multipart/form-data">\n${inputs}\n  <input name="${configuration.honeypotField}" tabindex="-1" autocomplete="off" hidden>\n  <button type="submit">Send</button>\n  <p role="status" aria-live="polite"></p>\n</form>`;
  const fetchCode = `const form = document.querySelector('#contact');\nform.addEventListener('submit', async (event) => {\n  event.preventDefault();\n  const button = form.querySelector('button');\n  const status = form.querySelector('[role=status]');\n  button.disabled = true; status.textContent = 'Sending…';\n  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10000);\n  try {\n    const response = await fetch('${configuration.endpoint}', { method: 'POST', body: new FormData(form), headers: { 'Idempotency-Key': crypto.randomUUID() }, signal: controller.signal });\n    const result = await response.json(); if (!response.ok) throw new Error(result.error?.message || 'Submission failed');\n    status.textContent = result.message; form.reset();\n  } catch (error) { status.textContent = error.name === 'AbortError' ? 'Request timed out.' : error.message; }\n  finally { clearTimeout(timeout); button.disabled = false; }\n});`;
  const reactFields = configuration.fields
    .map((field) =>
      field.type === "textarea"
        ? `      <label>${field.name} <textarea name="${field.name}"${field.required ? " required" : ""} /></label>`
        : `      <label>${field.name} <input name="${field.name}" type="${field.type}"${field.required ? " required" : ""} /></label>`,
    )
    .join("\n");
  const react = `'use client';\nimport { useState } from 'react';\nexport function ContactForm() {\n  const [status, setStatus] = useState(''); const [pending, setPending] = useState(false);\n  async function submit(event) { event.preventDefault(); setPending(true); setStatus('Sending…'); const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10000); try { const response = await fetch('${configuration.endpoint}', { method: 'POST', body: new FormData(event.currentTarget), headers: { 'Idempotency-Key': crypto.randomUUID() }, signal: controller.signal }); const result = await response.json(); if (!response.ok) throw new Error(result.error?.message || 'Submission failed'); setStatus(result.message); event.currentTarget.reset(); } catch (error) { setStatus(error.name === 'AbortError' ? 'Request timed out.' : error.message); } finally { clearTimeout(timer); setPending(false); } }\n  return <form onSubmit={submit}>\n${reactFields}\n      <input name="${configuration.honeypotField}" tabIndex={-1} autoComplete="off" hidden />\n      <button disabled={pending}>Send</button><p role="status" aria-live="polite">{status}</p>\n    </form>;\n}`;
  return {
    html: form,
    fetch: `${form}\n<script type="module">\n${fetchCode}\n</script>`,
    react,
    nextjs: react,
    "next-server-action": `// app/contact/actions.ts\n'use server';\nexport async function submit(formData: FormData) { const response = await fetch('${configuration.endpoint}', { method: 'POST', body: formData, headers: { 'Idempotency-Key': crypto.randomUUID() }, signal: AbortSignal.timeout(10000) }); const result = await response.json(); if (!response.ok) return { error: result.error?.message || 'Submission failed' }; return { message: result.message }; }`,
    vue: `<script setup>\nimport { ref } from 'vue'; const status = ref(''); const pending = ref(false);\nasync function submit(event) { pending.value = true; try { const response = await fetch('${configuration.endpoint}', { method: 'POST', body: new FormData(event.currentTarget), headers: { 'Idempotency-Key': crypto.randomUUID() }, signal: AbortSignal.timeout(10000) }); const result = await response.json(); status.value = response.ok ? result.message : result.error.message; if (response.ok) event.currentTarget.reset(); } catch { status.value = 'Network or timeout error.'; } finally { pending.value = false; } }\n</script>\n<template><form @submit.prevent="submit">${inputs}<input name="${configuration.honeypotField}" tabindex="-1" autocomplete="off" hidden><button :disabled="pending">{{ pending ? 'Sending…' : 'Send' }}</button><p role="status" aria-live="polite">{{ status }}</p></form></template>`,
    svelte: `<script>let status = ''; let pending = false; async function submit(event) { pending = true; try { const response = await fetch('${configuration.endpoint}', { method: 'POST', body: new FormData(event.currentTarget), headers: { 'Idempotency-Key': crypto.randomUUID() }, signal: AbortSignal.timeout(10000) }); const result = await response.json(); status = response.ok ? result.message : result.error.message; if (response.ok) event.currentTarget.reset(); } catch { status = 'Network or timeout error.'; } finally { pending = false; } }</script>\n<form on:submit|preventDefault={submit}>${inputs}<input name="${configuration.honeypotField}" tabindex="-1" autocomplete="off" hidden><button disabled={pending}>{pending ? 'Sending…' : 'Send'}</button><p role="status" aria-live="polite">{status}</p></form>`,
    astro: `${form}\n<script>${fetchCode}</script>`,
    framer: `// Framer code component: use the React example and set endpoint to ${configuration.endpoint}. No secret is required.\n${react}`,
    webflow: `<!-- Add before </body>; retain Webflow labels and required attributes. -->\n${fetchCode}`,
  };
}

export function integrationSnippet(
  platform: "html" | "react" | "nextjs",
  configuration: { endpoint: string; honeypotField: string },
): string {
  const snippets = integrationSnippets({
    endpoint: configuration.endpoint,
    honeypotField: configuration.honeypotField,
    fields: [{ name: "email", type: "email", required: true }],
    allowedDomains: [],
  });
  return snippets[platform];
}
