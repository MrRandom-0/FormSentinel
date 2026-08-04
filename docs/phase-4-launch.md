# Phase 4 launch readiness

**Status: local preview complete; hosted production is not ready.** Phase 4 supplies versioned commercial, billing, quota, security, abuse, privacy, admin, observability, schema, and deployment contracts. It does not turn missing infrastructure into success.

## Commercial catalog

Catalog version `2026-08-01` is owned by `@formsentinel/entitlements`. Monthly prices are Free $0, Starter $19, Pro $49, and Agency $149. Core limits are Free 2 forms/1 member/100 submissions, Starter 10/3/1,000, Pro 50/10/10,000, and Agency 250/50/100,000. The package is authoritative for file, storage, retention, webhook, integration, API, MCP, report, and agency limits. Stripe price IDs remain server environment configuration and client-provided IDs are never accepted. Monthly quota warns at 80%, denies new acceptance at 100%, and records 120% reconciliation crossings; no plan currently permits live overage. Billing grace is 0/3/7/14 days. Temporary overrides require workspace, actor, reason, ticket, start, and expiry and are audited.

Accepted public submissions, including spam and test submissions, count toward quota to prevent bypass. Synthetic monitor traffic must not use the public accepted-submission path. Idempotent replay is checked before quota and never bills twice.

## Launch criteria

Hosted launch remains blocked until all required probes pass against real deployed dependencies: PostgreSQL migrations and web auth/control-plane adapter, private object storage, managed KMS, malware scanner, durable rate limiting, Stripe live key/webhook/complete price mapping, production email/delivery adapters, operator IdP with mandatory MFA, backups plus a tested restore, and staged service-to-service integration. The current web production control plane explicitly refuses local JSON fallback.

Capabilities are reported separately. Local filesystem, local keys, captured providers, fixture Stripe events, static scanner results, and no-op Sentry never count as provider or deployed success. Browser accessibility: unverified because this environment has no real browser runtime; static semantic checks pass independently. PDF, browser rendering, managed storage/KMS/malware scanning, official integrations, and production platform admin remain unavailable until their genuine adapters probe.

## SLO and performance evidence

Proposed launch SLOs (not production-proven): 99.9% monthly ingest availability, p95 accepted submission under 500 ms excluding upload transfer, p99 under 1.5 s, queue age p95 under 60 s, and webhook processing p95 under 30 s. `pnpm test:load` is only a deterministic local smoke: 1,000 concurrent idempotent ledger calls, exactly one commit, under 2 seconds. Passing it is not deployed capacity evidence.

## Readiness semantics

`/health` is process liveness. `/ready` probes required dependencies and returns 503 when any required dependency is missing. `/version` reports release SHA, service version, schema version, and entitlement catalog version without secrets. Optional capability states never make readiness green.
