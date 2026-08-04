# Phase 3 development

1. Copy `.env.example` to `.env.local` and replace session, source-hash, service, MCP-hash, and local-encryption development values.
2. Run `pnpm install` and `pnpm dev`. Web, ingest, worker, scanner, and MCP use ports 3000–3004.
3. Create and verify a local account, workspace, and form. Submit from `/app/forms/{id}/test`.
4. Open `/app/copilot`, `/app/scanner`, `/app/schema-drift`, `/app/health`, `/app/reliability`, `/app/analytics`, `/app/routing`, `/app/integrations`, `/app/agency`, `/app/reports`, or `/app/mcp-tokens` to inspect truthful feature states.
5. Workers poll normally; a service operator may call `POST http://localhost:3002/v1/jobs/process` with `SERVICE_TOKEN`. User and MCP access never uses that token.

Local data uses `FORMSENTINEL_LOCAL_DATA_FILE`; private files and reports use `FORMSENTINEL_LOCAL_STORAGE_DIR`. Every local durable/capture/key adapter refuses production. Delete the ignored local paths to reset development data.

Run gates in order: `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:phase2`, `pnpm test:phase3`, `pnpm test:phase3:security`, `pnpm db:generate`, `pnpm db:check`, and `pnpm build`. PostgreSQL application tests additionally require a live database; static scan tests inject DNS/fetch and need no network.
