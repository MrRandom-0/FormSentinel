import { createServer } from "node:http";
import { getRequestListener, type HttpBindings } from "@hono/node-server";
import { Hono } from "hono";
import { readServerEnvironment, release } from "@formsentinel/config";
import { scanStaticHtml, type ScanDependencies } from "@formsentinel/scanner";
import { LocalPhase3Store, type Phase3Repository } from "@formsentinel/phase3-store";
import { constantTimeEqual } from "@formsentinel/security";
export interface ScannerAppDependencies extends Partial<ScanDependencies> {
  serviceToken: string;
  repository?: Phase3Repository;
}
export function createScannerApp(dependencies: ScannerAppDependencies) {
  const app = new Hono<{ Bindings: HttpBindings }>();
  app.get("/health", (context) => context.json({ status: "ok", service: "scanner" }));
  app.get("/ready", (context) =>
    context.json(
      {
        status: dependencies.repository ? "ready" : "unavailable",
        service: "scanner",
        browser: "unavailable",
        mode: dependencies.repository ? "persisted_bounded_static_html" : "persistence_unavailable",
      },
      dependencies.repository ? 200 : 503,
    ),
  );
  app.get("/version", (context) => context.json(release()));
  app.post("/v1/scans", async (context) => {
    const provided =
      (context.req.header("authorization") ?? "").replace(/^Bearer\s+/i, "") ||
      context.req.header("x-service-token") ||
      "";
    if (!dependencies.serviceToken || !constantTimeEqual(provided, dependencies.serviceToken))
      return context.json({ error: "unauthorized" }, 401);
    if (!dependencies.repository)
      return context.json({ error: "scanner_persistence_unavailable" }, 503);
    let body: {
      workspaceId?: unknown;
      formId?: unknown;
      url?: unknown;
      actual?: unknown;
      platform?: unknown;
    };
    try {
      body = await context.req.json();
    } catch {
      return context.json({ error: "invalid_json" }, 400);
    }
    if (
      typeof body.workspaceId !== "string" ||
      typeof body.formId !== "string" ||
      typeof body.url !== "string" ||
      !body.actual ||
      typeof body.actual !== "object"
    )
      return context.json({ error: "invalid_request" }, 400);
    const actual = body.actual as {
      endpoint?: unknown;
      fields?: unknown;
      allowedOrigins?: unknown;
    };
    if (
      typeof actual.endpoint !== "string" ||
      !Array.isArray(actual.fields) ||
      !Array.isArray(actual.allowedOrigins)
    )
      return context.json({ error: "invalid_configuration" }, 400);
    const repository = dependencies.repository;
    const run = await repository.create({
      kind: "scanner_run",
      workspaceId: body.workspaceId,
      formId: body.formId,
      data: { url: body.url, status: "running", browserStatus: "unavailable" },
    });
    try {
      const result = await scanStaticHtml(
        body.url,
        {
          actual: {
            endpoint: actual.endpoint,
            fields: actual.fields as { name: string; type: string; required: boolean }[],
            allowedOrigins: actual.allowedOrigins as string[],
          },
        },
        dependencies,
      );
      await Promise.all(
        result.evidence.map((item, sequence) =>
          repository.create({
            kind: "scanner_evidence",
            workspaceId: body.workspaceId as string,
            formId: body.formId as string,
            immutable: true,
            data: { runId: run.id, sequence, ...item },
          }),
        ),
      );
      await repository.update(body.workspaceId, "scanner_run", run.id, run.version, {
        url: body.url,
        status: result.status,
        browserStatus: result.status === "browser_unavailable" ? "unavailable" : "not_required",
        finalUrl: result.finalUrl,
        httpStatus: result.httpStatus,
      });
      return context.json({ scanRunId: run.id, ...result }, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : "scan_failed";
      await repository.update(body.workspaceId, "scanner_run", run.id, run.version, {
        url: body.url,
        status: "failed",
        browserStatus: "unavailable",
        error: message,
      });
      return context.json({ scanRunId: run.id, error: message }, 422);
    }
  });
  return app;
}
export function defaultScannerDependencies(): ScannerAppDependencies {
  const configuration = readServerEnvironment();
  return {
    serviceToken: configuration.SERVICE_TOKEN,
    ...(configuration.NODE_ENV === "production"
      ? {}
      : {
          repository: new LocalPhase3Store(
            configuration.FORMSENTINEL_LOCAL_DATA_FILE,
            configuration.NODE_ENV,
          ),
        }),
  };
}
export function createScannerServer(dependencies = defaultScannerDependencies()) {
  return createServer(getRequestListener(createScannerApp(dependencies).fetch));
}
if (process.env.NODE_ENV !== "test")
  createScannerServer().listen(Number(process.env.SCANNER_PORT || process.env.PORT || 3003), () =>
    console.log("scanner listening"),
  );
