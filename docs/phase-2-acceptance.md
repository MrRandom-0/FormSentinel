# Phase 2 acceptance and limitations

## Accepted local flow

An authorized user creates a workspace/form in web. Hono ingest accepts any supported content type, validates actual bytes/origin/schema/CAPTCHA/spam/files, and atomically stores submission/event/job. It responds before delivery work. A lease-based worker scans files and fans out independent notification, autoresponder, and webhook records. Local destinations are durable `captured_local`. The tenant-scoped inbox and detail page expose filters, fields/source/spam/timeline/files/delivery retries, status/tag/spam/delete/restore/replay actions, sanitized JSON, and formula-safe CSV.

Automated coverage includes validation, spam, source trust, rate limits, idempotency/fingerprints, leases/retries, signatures/SSRF, file magic/EICAR, email/CSV safety, tenant authorization, all content types/CORS/errors, worker side-effect dedupe, and an isolated end-to-end durable flow.

## Honest limitations

The ingest reader enforces a streamed hard cap, then parses the bounded body in memory; larger tiers would need fully streaming multipart/JSON parsers. Memory rate limiting is injectable and suitable for one local process; horizontally scaled production needs a durable/provider implementation. Turnstile requires its credential. No production transactional-email or private object-store adapter is bundled, and no AI spam adapter is implemented. Local webhook/email are captures, never delivery claims. OAuth, billing, scheduled monitoring, and Phase 3 features remain outside Phase 2.
