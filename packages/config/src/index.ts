import { z } from "zod";
import type { LimitKey } from "@formsentinel/entitlements";

export { catalog as plans, entitlementLimit } from "@formsentinel/entitlements";
export type { PlanId } from "@formsentinel/entitlements";
export type Entitlement = LimitKey;

export const brand = {
  name: "FormSentinel",
  shortName: "FS",
  description: "Durable form ingestion and asynchronous processing infrastructure.",
  supportEmail: "support@formsentinel.example",
  colors: { ink: "#0b1020", signal: "#5b5cf0", accent: "#20c6a5" },
} as const;

const serverEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  FORMSENTINEL_DATA_ADAPTER: z.enum(["local", "postgres"]).default("local"),
  FORMSENTINEL_AUTH_ADAPTER: z.enum(["local", "provider"]).default("local"),
  FORMSENTINEL_LOCAL_DATA_FILE: z.string().default(".formsentinel/dev-data.json"),
  FORMSENTINEL_LOCAL_STORAGE_DIR: z.string().default(".formsentinel/files"),
  DATABASE_URL: z.string().url().optional().or(z.literal("")),
  SESSION_SECRET: z.string().min(32).default("development-only-session-secret-change-me"),
  SOURCE_HASH_SECRET: z.string().min(16).default("development-source-hash-secret"),
  SERVICE_TOKEN: z.string().default("development-service-token"),
  MCP_TOKEN_HASH_SECRET: z.string().min(16).default("development-mcp-token-hash-secret"),
  LOCAL_ENCRYPTION_KEY: z.string().min(16).default("development-local-encryption-key"),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  INGEST_MAX_BODY_BYTES: z.coerce.number().int().positive().max(25_000_000).default(12_582_912),
  WORKER_CONCURRENCY: z.coerce.number().int().positive().max(32).default(4),
  WORKER_LEASE_MS: z.coerce.number().int().min(1_000).max(600_000).default(30_000),
  WORKER_POLL_MS: z.coerce.number().int().min(50).max(60_000).default(1_000),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  RELEASE_SHA: z.string().default("development"),
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function readServerEnvironment(source: NodeJS.ProcessEnv = process.env): ServerEnvironment {
  const environment = serverEnvironmentSchema.parse(source);
  if (environment.NODE_ENV === "production" && environment.FORMSENTINEL_DATA_ADAPTER === "local") {
    throw new Error("The local data adapter is disabled in production. Configure PostgreSQL.");
  }
  if (environment.FORMSENTINEL_DATA_ADAPTER === "postgres" && !environment.DATABASE_URL) {
    throw new Error("DATABASE_URL is required when the PostgreSQL adapter is selected.");
  }
  if (environment.NODE_ENV === "production" && environment.SERVICE_TOKEN.length < 32) {
    throw new Error("SERVICE_TOKEN must be at least 32 characters in production.");
  }
  if (
    environment.NODE_ENV === "production" &&
    (environment.MCP_TOKEN_HASH_SECRET.length < 32 ||
      environment.MCP_TOKEN_HASH_SECRET === environment.SERVICE_TOKEN)
  ) {
    throw new Error("MCP_TOKEN_HASH_SECRET must be independent and at least 32 characters.");
  }
  if (environment.NODE_ENV === "production" && environment.LOCAL_ENCRYPTION_KEY.length < 32) {
    throw new Error(
      "A production key-provider adapter is required; local encryption keys are insufficient.",
    );
  }
  if (environment.NODE_ENV === "production" && environment.SOURCE_HASH_SECRET.length < 32) {
    throw new Error("SOURCE_HASH_SECRET must be at least 32 characters in production.");
  }
  return environment;
}

export const release = (source: NodeJS.ProcessEnv = process.env) => ({
  serviceVersion: "0.4.0",
  phase: 4,
  releaseSha: source.RELEASE_SHA || "development",
  schemaVersion: "0007",
  entitlementCatalogVersion: "2026-08-01",
});
