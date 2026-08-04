import { describe, expect, it } from "vitest";
import {
  autoresponderEmail,
  escapeHtml,
  preventHeaderInjection,
  submissionEmail,
  validReplyTo,
} from "./index";
describe("email safety", () => {
  it("escapes submitted HTML", () =>
    expect(
      submissionEmail({ formName: "Contact", fields: { message: "<img onerror=x>" } }).html,
    ).toContain("&lt;img"));
  it("rejects header injection", () =>
    expect(() => preventHeaderInjection("subject\r\nBcc: victim@example.test")).toThrow());
  it("renders autoresponders as bounded safe text and HTML", () => {
    const message = autoresponderEmail({
      to: "person@example.test",
      subject: "Thanks",
      body: "Hello <visitor>",
    });
    expect(message.text).toBe("Hello <visitor>");
    expect(message.html).toContain("Hello &lt;visitor&gt;");
    expect(() =>
      autoresponderEmail({
        to: "person@example.test",
        subject: "Thanks\nBcc: victim@example.test",
        body: "Hello",
      }),
    ).toThrow();
  });
  it("selects reply-to only from validated email fields", () =>
    expect(
      validReplyTo({ email: "person@example.test", name: "other@example.test" }, [
        { name: "name", type: "text" },
        { name: "email", type: "email" },
      ]),
    ).toBe("person@example.test"));
  it("escapes all HTML metacharacters", () =>
    expect(escapeHtml("<&\"'")).toBe("&lt;&amp;&quot;&#39;"));
});
