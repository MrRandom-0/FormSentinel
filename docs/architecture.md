# Phase 4 architecture

FormSentinel is a pnpm/Turborepo monorepo with five runtime services. `apps/web` owns authenticated tenant operations and Phase 3 views, `apps/ingest` accepts public submissions, `apps/worker` dispatches leased jobs, `apps/scanner` performs bounded static HTML scans, and `apps/mcp` exposes scoped JSON-RPC/MCP tools. Every runtime exposes `/health`, `/ready`, and `/version`. Phase 4 adds central entitlements, usage, billing, API-key, abuse, privacy, platform-admin, and observability contracts. Hosted production remains not ready because the PostgreSQL web auth/control-plane and managed storage/KMS/scanner adapters are not implemented; local preview is labeled and production fallbacks refuse.

## Domain boundaries

Phase 2 submission behavior remains in `submissions`, `queue`, `storage`, `captcha`, `spam`, `email`, and `webhooks`. Phase 3 adds deterministic `integration-copilot`, `network-policy`, `scanner`, `schema-drift`, `monitoring`, `reliability`, `routing`, privacy-safe `analytics`, named `integrations`, `mcp-tools`, `agency`, `reports`, `@formsentinel/react`, and `phase3-store`. HTTP and UI concerns remain in apps.

## Persistence and jobs

Migrations `0004_acoustic_blockbuster.sql` through the Phase 4 tenant-integrity migrations prepare normalized Phase 3 tables and composite workspace-parent constraints; they do not constitute a wired production repository. The canonical local Phase 3 store uses a cross-process lock, mode-0600 temporary writes, atomic rename, exact workspace/form scope, ID-only queue payloads, dedupe, leases, retries, and dead letters. It refuses production. PostgreSQL is operational for Phase 2 submissions only; Phase 3 PostgreSQL runtime paths remain explicitly unavailable rather than falling back to memory or local JSON.

The local worker dispatches scan, health, alerts, reliability, integration-delivery, analytics-aggregation, and report queues to persisted checkpoint handlers. Production Phase 3 dispatch remains unavailable until a PostgreSQL queue and domain handlers are wired. Synthetic submission suppression in the Phase 2 processing path remains unchanged.

## Honest adapter model

Local email, alerts, and every named integration return `captured_local`; they never claim provider delivery. Official provider connections stay `unavailable` until credential adapters exist. Generic webhooks use signed safe transport. Static scanning is available locally, but browser-rendered inspection is `browser_unavailable` without an isolated browser runtime. JSON, CSV, and self-contained HTML reports are available in private storage; PDF is unavailable without an isolated renderer. Production must inject durable rate limiting, key management, private object storage, and official credentials.
