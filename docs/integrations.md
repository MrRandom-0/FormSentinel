# Integrations

The registry names Slack, Discord, Telegram, Google Sheets, Notion, Airtable, Zapier, Make, generic webhook, and email. Every adapter explains requested permissions and provides connect, test, disconnect, health, audit-ready state, delivery, and retry semantics.

In development/test every named provider can be explicitly `captured_local`; that state is returned only after an immutable, idempotency-keyed, redacted capture is persisted. It is not connected to an external account and never reports delivered. Production provider actions are `unavailable` until official credential and PostgreSQL capture adapters are configured. Generic HTTPS webhooks can use the existing signed, SSRF-safe transport. UI cards are local previews, not connected provider controls.
