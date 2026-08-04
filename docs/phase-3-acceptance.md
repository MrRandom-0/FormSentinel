# Phase 3 acceptance and limitations

## Passed local capabilities

The automated local suite verifies non-executing lexical Copilot heuristics with confidence/provenance and unsupported coverage; pinned static HTTP scanning with per-hop DNS validation, Host/SNI preservation, connected-peer checks, redirects and size bounds; immutable schema-drift history; synthetic monitor suppression and incident recovery; reliability calculations; form-scoped MCP isolation; privacy-safe analytics validation; bounded routing; persisted redacted local integration captures; workspace-authorized report evidence and restart-discoverable manifests; agency isolation; and the Phase 2 submission regression flow.

The scanner HTTP service authenticates requests, requires workspace/form identifiers, persists scan runs and evidence in the local Phase 3 repository, and refuses scans when persistence is unavailable. The local worker configures every Phase 3 queue and a persisted dispatch checkpoint handler. The MCP executable starts an HTTP listener when `MCP_PORT` (or `PORT`) is configured; its local token repository is usable, while form operations explicitly report unavailable until a repository-backed MCP form adapter is supplied.

All web Phase 3 cards are labeled **Local preview**. They describe tested package capabilities and are not live authenticated control-plane routes.

## Unavailable or unverified capabilities

- **Production Phase 3 PostgreSQL runtime:** unavailable. Generated PostgreSQL DDL now enforces composite tenant associations for Phase 3 parents, but normalized Phase 3 tables are schema-prepared and are not yet wired as production runtime repositories. Production never falls back to local JSON or memory.
- **Live PostgreSQL verification:** not run without a provisioned PostgreSQL server. `db:generate` and `db:check` verify generated migration consistency only.
- **Browser scanning:** `browser_unavailable` without an isolated browser runtime.
- **Official providers:** Slack, Discord, Telegram, Google Sheets, Notion, Airtable, Zapier, Make, and external email remain `unavailable` without official credential adapters. Development `captured_local` means an immutable redacted capture was persisted; it never means provider delivery.
- **PDF:** `pdf_renderer_unavailable` without a real isolated renderer.
- **Web Phase 3 operations:** preview pages are not live repository-backed routes. Scanner is the only persisted Phase 3 HTTP workflow in this checkpoint.
- **Production MCP form tools and Phase 3 workers:** unavailable until PostgreSQL repository/queue adapters are wired. Local MCP listening/token auth and local worker dispatch are covered by HTTP/process or queue tests.
- **Production infrastructure:** durable distributed rate limits, managed envelope keys, and private object storage still require external infrastructure.
