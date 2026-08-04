import { createServer } from "node:http";
import { getRequestListener, type HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import { release, readServerEnvironment } from "@formsentinel/config";
import { McpToolService, type McpRepository, type McpToolName } from "@formsentinel/mcp-tools";
import { LocalPhase3Store, LocalScopedTokenRepository } from "@formsentinel/phase3-store";
import { ScopedTokenService, type TokenScope } from "@formsentinel/security";
export interface McpAppDependencies {
  tools: McpToolService;
  resolveToken(
    token: string,
    workspaceId: string,
  ): Promise<{ scopes: readonly TokenScope[] } | null>;
}
const errorCode = (message: string) =>
  message === "method_not_found"
    ? -32601
    : message === "rate_limited"
      ? -32029
      : message === "unauthorized" || message === "forbidden"
        ? -32001
        : -32602;
export function createMcpApp(dependencies: McpAppDependencies) {
  const app = new Hono<{ Bindings: HttpBindings }>();
  app.get("/health", (context) => context.json({ status: "ok", service: "mcp" }));
  app.get("/ready", (context) =>
    context.json({ status: "ready", service: "mcp", auth: "hashed_scoped_tokens" }),
  );
  app.get("/version", (context) => context.json(release()));
  app.post("/mcp", async (context) => {
    let request: { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };
    try {
      request = await context.req.json();
    } catch {
      return context.json(
        { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } },
        400,
      );
    }
    const token = (context.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
    const workspaceId = context.req.header("x-workspace-id") ?? "";
    if (!token || !workspaceId)
      return context.json(
        {
          jsonrpc: "2.0",
          id: request.id ?? null,
          error: { code: -32001, message: "Unauthorized" },
        },
        401,
      );
    try {
      if (request.method === "tools/list") {
        const identity = await dependencies.resolveToken(token, workspaceId);
        if (!identity) throw new Error("unauthorized");
        return context.json({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            tools: dependencies.tools
              .listTools(identity.scopes)
              .map((name) => ({ name, inputSchema: { type: "object" } })),
          },
        });
      }
      if (request.method !== "tools/call") throw new Error("method_not_found");
      const params =
        request.params && typeof request.params === "object"
          ? (request.params as { name?: unknown; arguments?: unknown })
          : {};
      const result = await dependencies.tools.call({
        token,
        workspaceId,
        name: params.name as McpToolName,
        arguments: params.arguments,
      });
      return context.json({
        jsonrpc: "2.0",
        id: request.id,
        result: { content: [{ type: "text", text: JSON.stringify(result) }] },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid_request";
      return context.json(
        { jsonrpc: "2.0", id: request.id ?? null, error: { code: errorCode(message), message } },
        message === "unauthorized" || message === "forbidden"
          ? 401
          : message === "rate_limited"
            ? 429
            : 400,
      );
    }
  });
  return app;
}
const unavailableRepository: McpRepository = {
  listForms: async () => [],
  getForm: async () => null,
  createForm: async () => {
    throw new Error("mcp_form_repository_unavailable");
  },
  testSubmission: async () => {
    throw new Error("mcp_submission_repository_unavailable");
  },
  health: async () => ({ status: "unavailable", reason: "mcp_form_repository_unavailable" }),
  reliability: async () => ({ status: "unavailable", reason: "mcp_form_repository_unavailable" }),
};
export function defaultMcpDependencies(): McpAppDependencies {
  const configuration = readServerEnvironment();
  if (configuration.NODE_ENV === "production")
    throw new Error("mcp_postgres_repository_unavailable");
  const store = new LocalPhase3Store(
    configuration.FORMSENTINEL_LOCAL_DATA_FILE,
    configuration.NODE_ENV,
  );
  const tokens = new ScopedTokenService(
    new LocalScopedTokenRepository(store),
    configuration.MCP_TOKEN_HASH_SECRET,
  );
  return {
    tools: new McpToolService(tokens, unavailableRepository),
    resolveToken: async (token, workspaceId) => {
      try {
        return await tokens.authenticate(token, workspaceId);
      } catch {
        return null;
      }
    },
  };
}
export function createMcpServer(dependencies: McpAppDependencies) {
  return createServer(getRequestListener(createMcpApp(dependencies).fetch));
}
if (process.env.NODE_ENV !== "test") {
  const configuredPort = process.env.MCP_PORT || process.env.PORT;
  if (configuredPort)
    createMcpServer(defaultMcpDependencies()).listen(Number(configuredPort), () =>
      console.log("mcp listening"),
    );
}
