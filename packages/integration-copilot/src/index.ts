export type SourceLanguage = "html" | "javascript" | "typescript" | "jsx" | "tsx";
export type FindingSeverity = "info" | "warning" | "error" | "critical";
export interface SourceRange {
  start: number;
  end: number;
  line: number;
  column: number;
}
export interface Evidence {
  text: string;
  range: SourceRange;
}
export interface IntegrationFinding {
  code: string;
  severity: FindingSeverity;
  message: string;
  evidence?: Evidence;
  suggestion?: string;
  provenance?: "lexical_heuristic";
  confidence?: "low" | "medium" | "high";
}
export interface ObservedField {
  name: string;
  type: string;
  required: boolean;
  label: string | null;
  range: SourceRange;
}
export interface IntegrationAnalysis {
  language: SourceLanguage;
  supported: boolean;
  analysisMethod: "lexical_heuristic";
  unsupportedCoverage: readonly string[];
  forms: readonly {
    action: string | null;
    method: string;
    fields: readonly ObservedField[];
    hasSubmit: boolean;
    range: SourceRange;
  }[];
  states: { loading: boolean; success: boolean; error: boolean };
  findings: readonly IntegrationFinding[];
}
export interface ActualFormConfiguration {
  endpoint: string;
  fields: readonly { name: string; type: string; required: boolean }[];
  allowedOrigins: readonly string[];
}
const lineRange = (source: string, start: number, end: number): SourceRange => {
  const before = source.slice(0, start);
  const lines = before.split("\n");
  return { start, end, line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
};
const attribute = (tag: string, name: string): string | null => {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:["']([^"']*)["']|([^\\s>]+))`, "i").exec(tag);
  return match?.[1] ?? match?.[2] ?? null;
};
const hasAttribute = (tag: string, name: string) =>
  new RegExp(`\\b${name}(?:\\s|=|/?>)`, "i").test(tag);
const evidence = (source: string, match: RegExpExecArray): Evidence => ({
  text: match[0].slice(0, 240),
  range: lineRange(source, match.index, match.index + match[0].length),
});
const secretPattern =
  /(?:sk_live_|api[_-]?key|client[_-]?secret|service[_-]?token|bearer\s+[a-z0-9._-]{12,})/i;
function securityFindings(source: string, searchable = source): IntegrationFinding[] {
  const findings: IntegrationFinding[] = [];
  const secret = secretPattern.exec(searchable);
  if (secret)
    findings.push({
      code: "client_secret",
      severity: "critical",
      message:
        "A credential-like value appears in client source. Move secrets to a server-side provider.",
      evidence: evidence(source, secret),
    });
  if (/dangerouslySetInnerHTML\s*=|\beval\s*\(|new\s+Function\s*\(/.test(searchable)) {
    const unsafe = /dangerouslySetInnerHTML\s*=|\beval\s*\(|new\s+Function\s*\(/.exec(searchable)!;
    findings.push({
      code: "unsafe_client_code",
      severity: "error",
      message:
        "Unsafe executable or HTML injection syntax is present; FormSentinel never executes analyzed code.",
      evidence: evidence(source, unsafe),
    });
  }
  return findings.map((finding) => ({
    ...finding,
    provenance: "lexical_heuristic" as const,
    confidence: finding.evidence ? ("medium" as const) : ("low" as const),
  }));
}
function maskLexicallyIgnored(source: string): string {
  const output = [...source];
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockComment = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]!;
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      else output[index] = " ";
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        output[index] = output[index + 1] = " ";
        index += 1;
        blockComment = false;
      } else if (character !== "\n") output[index] = " ";
      continue;
    }
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = null;
      if (character !== "\n") output[index] = " ";
      continue;
    }
    if (character === "/" && next === "/") {
      output[index] = output[index + 1] = " ";
      index += 1;
      lineComment = true;
    } else if (character === "/" && next === "*") {
      output[index] = output[index + 1] = " ";
      index += 1;
      blockComment = true;
    } else if (character === "'" || character === '"' || character === "`") {
      output[index] = " ";
      quote = character;
    }
  }
  return output.join("");
}
function maskHtmlComments(source: string): string {
  return source.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, " "));
}
function parseHtml(source: string): IntegrationAnalysis {
  const searchable = maskHtmlComments(source);
  const forms: IntegrationAnalysis["forms"][number][] = [];
  const findings = securityFindings(source, searchable);
  const formPattern = /<form\b[^>]*>[\s\S]*?<\/form\s*>/gi;
  for (const match of searchable.matchAll(formPattern)) {
    const block = match[0];
    const start = match.index;
    const open = /^<form\b[^>]*>/i.exec(block)?.[0] ?? "";
    const fields: ObservedField[] = [];
    for (const input of block.matchAll(/<(input|textarea|select)\b[^>]*>/gi)) {
      const tag = input[0];
      const name = attribute(tag, "name");
      if (!name) continue;
      const absolute = start + input.index;
      const id = attribute(tag, "id");
      const labelMatch = id
        ? new RegExp(
            `<label\\b[^>]*for=["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>([\\s\\S]*?)<\\/label>`,
            "i",
          ).exec(block)
        : null;
      const label = labelMatch?.[1]?.replace(/<[^>]+>/g, "").trim() || attribute(tag, "aria-label");
      fields.push({
        name,
        type: attribute(tag, "type") ?? (input[1] ?? "input").toLowerCase(),
        required: hasAttribute(tag, "required"),
        label: label ?? null,
        range: lineRange(source, absolute, absolute + tag.length),
      });
      if (!label)
        findings.push({
          code: "missing_label",
          severity: "warning",
          message: `Field '${name}' has no associated label or aria-label.`,
          evidence: { text: tag, range: lineRange(source, absolute, absolute + tag.length) },
        });
    }
    const action = attribute(open, "action");
    const method = (attribute(open, "method") ?? "get").toLowerCase();
    const hasSubmit =
      /<button\b[^>]*(?:type=["']submit["'])?[^>]*>|<input\b[^>]*type=["']submit["']/i.test(block);
    forms.push({
      action,
      method,
      fields,
      hasSubmit,
      range: lineRange(source, start, start + block.length),
    });
    if (method !== "post")
      findings.push({
        code: "method_not_post",
        severity: "error",
        message: "Form method must be POST.",
        evidence: { text: open, range: lineRange(source, start, start + open.length) },
        suggestion: 'Set method="post".',
      });
    if (!action)
      findings.push({
        code: "missing_action",
        severity: "error",
        message: "Form has no submission endpoint.",
        evidence: { text: open, range: lineRange(source, start, start + open.length) },
      });
    if (!hasSubmit)
      findings.push({
        code: "missing_submit",
        severity: "warning",
        message: "Form has no visible submit control.",
      });
    const enctype = attribute(open, "enctype");
    if (fields.some((field) => field.type === "file") && enctype !== "multipart/form-data")
      findings.push({
        code: "file_enctype",
        severity: "error",
        message: "File fields require multipart/form-data encoding.",
      });
  }
  if (!forms.length)
    findings.push({
      code: "no_form",
      severity: "warning",
      message: "No static HTML form was found.",
    });
  return {
    language: "html",
    supported: true,
    analysisMethod: "lexical_heuristic",
    unsupportedCoverage: [
      "runtime behavior",
      "dynamically generated markup",
      "framework component aliases",
    ],
    forms,
    states: {
      loading: /loading|pending|submitting/i.test(searchable),
      success: /success|thank you|submitted/i.test(searchable),
      error: /error|failed|invalid/i.test(searchable),
    },
    findings,
  };
}
function parseScript(
  source: string,
  language: Exclude<SourceLanguage, "html">,
): IntegrationAnalysis {
  const searchable = maskLexicallyIgnored(source);
  const findings = securityFindings(source, searchable);
  const unsupported = /\bwith\s*\(|@\w+|<%|\bimport\s*\(/.exec(searchable);
  if (unsupported)
    return {
      language,
      supported: false,
      analysisMethod: "lexical_heuristic",
      unsupportedCoverage: ["unsupported syntax", "runtime behavior", "module resolution"],
      forms: [],
      states: { loading: false, success: false, error: false },
      findings: [
        ...findings,
        {
          code: "unsupported_syntax",
          severity: "warning",
          message: "This syntax is outside the deterministic static parser subset.",
          evidence: evidence(source, unsupported),
        },
      ],
    };
  let depth = 0;
  for (const character of searchable) {
    if (character === "{" || character === "(" || character === "[") depth += 1;
    if (character === "}" || character === ")" || character === "]") depth -= 1;
    if (depth < 0) break;
  }
  if (depth !== 0)
    return {
      language,
      supported: false,
      analysisMethod: "lexical_heuristic",
      unsupportedCoverage: ["unsupported syntax", "runtime behavior", "module resolution"],
      forms: [],
      states: { loading: false, success: false, error: false },
      findings: [
        ...findings,
        {
          code: "unsupported_syntax",
          severity: "error",
          message: "Source contains unbalanced syntax and was not analyzed.",
        },
      ],
    };
  const forms: IntegrationAnalysis["forms"][number][] = [];
  for (const match of source.matchAll(/<form\b[^>]*>[\s\S]*?<\/form\s*>/gi)) {
    if (searchable[match.index] !== "<") continue;
    const html = parseHtml(match[0]);
    forms.push(
      ...html.forms.map((form) => ({
        ...form,
        range: lineRange(source, match.index, match.index + match[0].length),
        fields: form.fields.map((field) => ({
          ...field,
          range: lineRange(source, match.index + field.range.start, match.index + field.range.end),
        })),
      })),
    );
    findings.push(...html.findings.filter((item) => item.code !== "no_form"));
  }
  if (
    /fetch\s*\(|axios\s*\.|\.submit\s*\(/.test(searchable) &&
    !/try\s*\{|\.catch\s*\(/.test(searchable)
  )
    findings.push({
      code: "missing_error_state",
      severity: "warning",
      message: "Submission code has no observable error handling.",
    });
  return {
    language,
    supported: true,
    analysisMethod: "lexical_heuristic",
    unsupportedCoverage: [
      "runtime behavior",
      "framework component aliases",
      "computed attributes",
      "module resolution",
    ],
    forms,
    states: {
      loading: /isLoading|isPending|submitting|setLoading/i.test(searchable),
      success: /success|setSubmitted|thank/i.test(searchable),
      error: /error|setError|catch/i.test(searchable),
    },
    findings,
  };
}
export function analyzeIntegration(
  source: string,
  language: SourceLanguage,
  actual?: ActualFormConfiguration,
): IntegrationAnalysis {
  if (source.length > 1_000_000)
    return {
      language,
      supported: false,
      analysisMethod: "lexical_heuristic",
      unsupportedCoverage: ["unsupported syntax", "runtime behavior", "module resolution"],
      forms: [],
      states: { loading: false, success: false, error: false },
      findings: [
        {
          code: "source_too_large",
          severity: "error",
          message: "Source exceeds the 1 MB deterministic parser limit.",
        },
      ],
    };
  const parsed = language === "html" ? parseHtml(source) : parseScript(source, language);
  const result: IntegrationAnalysis = {
    ...parsed,
    findings: parsed.findings.map((finding) => ({
      ...finding,
      provenance: finding.provenance ?? "lexical_heuristic",
      confidence: finding.confidence ?? (finding.evidence ? "medium" : "low"),
    })),
  };
  if (!actual) return result;
  const findings = [...result.findings];
  for (const form of result.forms) {
    if (form.action && form.action !== actual.endpoint)
      findings.push({
        code: "endpoint_mismatch",
        severity: "error",
        message: `Observed endpoint does not match ${actual.endpoint}.`,
        evidence: { text: form.action, range: form.range },
      });
    const expected = new Map(actual.fields.map((field) => [field.name, field]));
    for (const field of form.fields)
      if (!expected.has(field.name))
        findings.push({
          code: "unexpected_field",
          severity: "warning",
          message: `Field '${field.name}' is not in the registered schema.`,
          evidence: { text: field.name, range: field.range },
        });
    for (const field of actual.fields)
      if (field.required && !form.fields.some((item) => item.name === field.name))
        findings.push({
          code: "missing_required_field",
          severity: "error",
          message: `Required field '${field.name}' is missing.`,
        });
  }
  return {
    ...result,
    findings: findings.map((finding) => ({
      ...finding,
      provenance: finding.provenance ?? "lexical_heuristic",
      confidence: finding.confidence ?? (finding.evidence ? "medium" : "low"),
    })),
  };
}
export function minimalUnifiedPatch(
  file: string,
  source: string,
  analysis: IntegrationAnalysis,
  actual: ActualFormConfiguration,
): string {
  const form = analysis.forms[0];
  if (!form)
    return `--- a/${file}\n+++ b/${file}\n@@\n-<!-- no static form found -->\n+<!-- Add a POST form targeting ${actual.endpoint}; review manually. -->`;
  const original = source.slice(form.range.start, form.range.end);
  const open = /^<form\b[^>]*>/i.exec(original)?.[0] ?? "<form>";
  let replacement = open;
  replacement = /\baction\s*=/.test(replacement)
    ? replacement.replace(
        /\baction\s*=\s*(?:["'][^"']*["']|[^\s>]+)/i,
        `action="${actual.endpoint}"`,
      )
    : replacement.replace(/>$/, ` action="${actual.endpoint}">`);
  replacement = /\bmethod\s*=/.test(replacement)
    ? replacement.replace(/\bmethod\s*=\s*(?:["'][^"']*["']|[^\s>]+)/i, 'method="post"')
    : replacement.replace(/>$/, ' method="post">');
  if (replacement === open) return "";
  return `--- a/${file}\n+++ b/${file}\n@@ -${form.range.line},1 +${form.range.line},1 @@\n-${open}\n+${replacement}`;
}
export const repairPlatforms = [
  "Lovable",
  "Bolt",
  "v0",
  "Cursor",
  "Claude Code",
  "Replit",
  "Windsurf",
] as const;
export function buildRepairPrompt(input: {
  platform: (typeof repairPlatforms)[number];
  analysis: IntegrationAnalysis;
  actual: ActualFormConfiguration;
  files: readonly string[];
  provenance: string;
  version?: string;
}): string {
  const facts =
    input.analysis.findings
      .map(
        (finding) =>
          `- [${finding.severity}] ${finding.code}: ${finding.message} (provenance: ${finding.provenance ?? "lexical_heuristic"}; confidence: ${finding.confidence ?? "low"})`,
      )
      .join("\n") || "- No lexical heuristic issues observed.";
  return [
    `FormSentinel repair prompt v${input.version ?? "1"} for ${input.platform}`,
    `Provenance: ${input.provenance.replace(/[\r\n]/g, " ").slice(0, 200)}`,
    "Lexical heuristic observations (not verified runtime facts):",
    facts,
    `Unsupported coverage: ${input.analysis.unsupportedCoverage.join(", ") || "none declared"}.`,
    "Actual registered configuration:",
    `- Endpoint: ${input.actual.endpoint}`,
    `- Allowed origins: ${input.actual.allowedOrigins.join(", ") || "none"}`,
    `- Fields: ${input.actual.fields.map((field) => `${field.name}:${field.type}${field.required ? " required" : ""}`).join(", ")}`,
    `Only edit these files: ${input.files.join(", ")}. Make the smallest patch. Do not expose credentials or invent runtime results.`,
    "Preserve accessible labels, keyboard/focus behavior, loading/success/error states, POST semantics, validation, and existing design.",
    "Test checklist: valid submit; validation failure; network failure; duplicate click; loading state; success state; screen-reader status; no client secrets.",
  ].join("\n");
}
