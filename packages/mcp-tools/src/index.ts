import {
  analyzeIntegration,
  buildRepairPrompt,
  type ActualFormConfiguration,
} from "@formsentinel/integration-copilot";
import type { ScopedTokenService, TokenScope } from "@formsentinel/security";
export const mcpToolNames = [
  "list_forms",
  "get_public_config",
  "create_form",
  "get_expected_schema",
  "validate_proposed_fields",
  "generate_integration_code",
  "test_submission",
  "get_health_status",
  "get_reliability_status",
  "get_repair_instructions",
] as const;
export type McpToolName = (typeof mcpToolNames)[number];
export interface McpForm {
  id: string;
  workspaceId: string;
  name: string;
  endpoint: string;
  fields: readonly { name: string; type: string; required: boolean }[];
  allowedOrigins: readonly string[];
}
export interface McpRepository {
  listForms(workspaceId: string): Promise<readonly McpForm[]>;
  getForm(workspaceId: string, formId: string): Promise<McpForm | null>;
  createForm(
    workspaceId: string,
    input: {
      name: string;
      fields: readonly { name: string; type: string; required: boolean }[];
      idempotencyKey: string;
    },
  ): Promise<McpForm>;
  testSubmission(
    workspaceId: string,
    formId: string,
    fields: Readonly<Record<string, string>>,
    idempotencyKey: string,
  ): Promise<{ submissionId: string; synthetic: true; externalSideEffectsSuppressed: true }>;
  health(workspaceId: string, formId?: string): Promise<unknown>;
  reliability(workspaceId: string, formId?: string): Promise<unknown>;
}
const requiredScope: Record<McpToolName, TokenScope> = {
  list_forms: "forms:read",
  get_public_config: "forms:read",
  create_form: "forms:create",
  get_expected_schema: "schema:read",
  validate_proposed_fields: "schema:read",
  generate_integration_code: "integration:generate",
  test_submission: "submissions:test",
  get_health_status: "health:read",
  get_reliability_status: "reliability:read",
  get_repair_instructions: "integration:generate",
};
export const defaultMcpScopes: readonly TokenScope[] = [
  "forms:read",
  "schema:read",
  "health:read",
  "reliability:read",
  "integration:generate",
];
const mutating = new Set<McpToolName>(["create_form", "test_submission"]);
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown, key: string): string => {
  if (typeof value !== "string" || !value.trim() || value.length > 500)
    throw new Error(`invalid_${key}`);
  return value;
};
export class McpToolService {
  constructor(
    private readonly tokens: ScopedTokenService,
    private readonly repository: McpRepository,
  ) {}
  listTools(scopes: readonly TokenScope[]): readonly McpToolName[] {
    return mcpToolNames.filter((name) => scopes.includes(requiredScope[name]));
  }
  async call(input: {
    token: string;
    workspaceId: string;
    name: McpToolName;
    arguments?: unknown;
  }): Promise<unknown> {
    if (!mcpToolNames.includes(input.name)) throw new Error("method_not_found");
    const args = object(input.arguments);
    const formId = typeof args.formId === "string" ? args.formId : undefined;
    const grant = await this.tokens.authorize(input.token, {
      workspaceId: input.workspaceId,
      ...(formId ? { formId } : {}),
      scope: requiredScope[input.name],
    });
    const formRestricted = grant.formIds.length > 0;
    if (
      formRestricted &&
      (input.name === "create_form" ||
        ((input.name === "get_health_status" || input.name === "get_reliability_status") &&
          !formId))
    )
      throw new Error("workspace_grant_required");
    if (
      mutating.has(input.name) &&
      (args.confirm !== true ||
        typeof args.idempotencyKey !== "string" ||
        args.idempotencyKey.length < 8)
    )
      throw new Error("confirmation_and_idempotency_required");
    switch (input.name) {
      case "list_forms": {
        const forms = await this.repository.listForms(input.workspaceId);
        return formRestricted ? forms.filter((form) => grant.formIds.includes(form.id)) : forms;
      }
      case "get_public_config": {
        const form = await this.requiredForm(input.workspaceId, text(args.formId, "form_id"));
        return { id: form.id, endpoint: form.endpoint, allowedOrigins: form.allowedOrigins };
      }
      case "create_form":
        return this.repository.createForm(input.workspaceId, {
          name: text(args.name, "name"),
          fields: this.fields(args.fields),
          idempotencyKey: args.idempotencyKey as string,
        });
      case "get_expected_schema":
        return (await this.requiredForm(input.workspaceId, text(args.formId, "form_id"))).fields;
      case "validate_proposed_fields": {
        const form = await this.requiredForm(input.workspaceId, text(args.formId, "form_id"));
        const proposed = this.fields(args.fields);
        const expected = new Map(form.fields.map((field) => [field.name, field]));
        return {
          valid:
            proposed.every((field) => expected.has(field.name)) &&
            form.fields
              .filter((field) => field.required)
              .every((field) => proposed.some((item) => item.name === field.name)),
          unexpected: proposed
            .filter((field) => !expected.has(field.name))
            .map((field) => field.name),
          missing: form.fields
            .filter((field) => field.required && !proposed.some((item) => item.name === field.name))
            .map((field) => field.name),
        };
      }
      case "generate_integration_code": {
        const form = await this.requiredForm(input.workspaceId, text(args.formId, "form_id"));
        return `<form action="${form.endpoint}" method="post">\n${form.fields.map((field) => `  <label>${field.name}<input name="${field.name}" type="${field.type}"${field.required ? " required" : ""}></label>`).join("\n")}\n  <button type="submit">Submit</button>\n  <p role="status" aria-live="polite"></p>\n</form>`;
      }
      case "test_submission":
        return this.repository.testSubmission(
          input.workspaceId,
          text(args.formId, "form_id"),
          Object.fromEntries(
            Object.entries(object(args.fields)).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          ),
          args.idempotencyKey as string,
        );
      case "get_health_status":
        return this.repository.health(input.workspaceId, formId);
      case "get_reliability_status":
        return this.repository.reliability(input.workspaceId, formId);
      case "get_repair_instructions": {
        const form = await this.requiredForm(input.workspaceId, text(args.formId, "form_id"));
        const actual: ActualFormConfiguration = {
          endpoint: form.endpoint,
          fields: form.fields,
          allowedOrigins: form.allowedOrigins,
        };
        const analysis = analyzeIntegration(
          text(args.source, "source"),
          (typeof args.language === "string" ? args.language : "html") as "html",
          actual,
        );
        return buildRepairPrompt({
          platform: "Cursor",
          analysis,
          actual,
          files: [typeof args.file === "string" ? args.file : "form.html"],
          provenance: "mcp-static-analysis",
          version: "3",
        });
      }
    }
  }
  private async requiredForm(workspaceId: string, formId: string): Promise<McpForm> {
    const form = await this.repository.getForm(workspaceId, formId);
    if (!form) throw new Error("not_found");
    return form;
  }
  private fields(value: unknown): { name: string; type: string; required: boolean }[] {
    if (!Array.isArray(value) || value.length > 100) throw new Error("invalid_fields");
    return value.map((item) => {
      const field = object(item);
      const name = text(field.name, "field_name");
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(name)) throw new Error("invalid_field_name");
      return { name, type: text(field.type, "field_type"), required: field.required === true };
    });
  }
}
