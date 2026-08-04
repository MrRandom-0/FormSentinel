export interface TransactionalEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
}
export interface EmailSender {
  readonly configured: boolean;
  send(message: TransactionalEmail): Promise<{ id: string }>;
}
export class UnconfiguredEmailSender implements EmailSender {
  readonly configured = false;
  async send(_message: TransactionalEmail): Promise<{ id: string }> {
    throw new Error("Email delivery is not configured.");
  }
}
export function preventHeaderInjection(value: string, maximum = 200): string {
  if (/\r|\n/.test(value)) throw new Error("Email headers must not contain line breaks.");
  return value.trim().slice(0, maximum);
}
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
export function submissionEmail(input: {
  formName: string;
  fields: Readonly<Record<string, unknown>>;
  replyTo?: string | null;
}): TransactionalEmail {
  const subject = preventHeaderInjection(`New submission: ${input.formName}`);
  const entries = Object.entries(input.fields)
    .slice(0, 100)
    .map(([key, value]) => [key.slice(0, 100), String(value).slice(0, 10_000)] as const);
  const text = entries
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")
    .slice(0, 100_000);
  const html = `<dl>${entries.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`;
  const message: TransactionalEmail = { to: "", subject, text, html };
  if (input.replyTo) message.replyTo = preventHeaderInjection(input.replyTo);
  return message;
}
export function autoresponderEmail(input: {
  to: string;
  subject: string;
  body: string;
}): TransactionalEmail {
  const subject = preventHeaderInjection(input.subject);
  const text = input.body.replaceAll("\r\n", "\n").replaceAll("\r", "\n").slice(0, 100_000);
  const html = text
    .split("\n")
    .map((line) => `<p>${escapeHtml(line) || "&nbsp;"}</p>`)
    .join("");
  return { to: preventHeaderInjection(input.to, 320), subject, text, html };
}
export function validReplyTo(
  fields: Readonly<Record<string, unknown>>,
  configuredFields: readonly { name: string; type: string }[],
): string | undefined {
  for (const field of configuredFields) {
    const value = fields[field.name];
    if (
      field.type === "email" &&
      typeof value === "string" &&
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) &&
      !/[\r\n]/.test(value)
    )
      return value;
  }
  return undefined;
}
