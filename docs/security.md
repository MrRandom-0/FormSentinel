# Phase 3 security baseline

Authentication uses salted scrypt, hashed opaque tokens, HTTP-only cookies, and server-side revocation. Every inbox/detail/action query verifies user membership and workspace scope. Public form ids are opaque; origin/CORS policy is an abuse control, never authentication.

Ingest ignores forwarded addresses unless `TRUSTED_PROXY_HOPS` is configured, stores keyed source hashes, limits actual bytes/fields/headers/files, forbids nested or ambiguous scalar fields, and permits only configured content types. Idempotency is scoped to form, key, and window; reuse with a different fingerprint returns conflict. Spam reasons are retained internally while public responses avoid rule-tuning detail.

Files receive generated private keys, extension/declared MIME/magic-byte checks, double-extension rejection, SHA-256 checksums, quarantine, and scanner state. `unavailable` never means clean; only authorized, clean, released files can be downloaded. Local files and JSON are mode 0600 and the adapters refuse production.

Webhook signatures cover `${timestamp}.${exactBody}` with HMAC-SHA-256. Production destinations require HTTPS and reject credentials, unsafe ports, localhost, loopback, private, link-local, multicast, metadata, documentation, and reserved addresses. DNS is resolved and every answer validated for each attempt; redirects are disabled. Transport timeouts and response handling are bounded.

Submitted values are escaped in HTML email, plain text is length-limited, header line breaks are rejected, reply-to comes only from validated email schema fields, and CSV cells beginning with formula characters are prefixed safely. Local captures never claim external delivery.

Phase 3 scanner policy validates every DNS answer and every redirect hop, rejects credentials and unsafe HTTP ports, and bounds headers, decompressed response bytes, redirects, and time. Copilot parsers never execute submitted source and return explicit unsupported findings.

Secrets use envelope-encryption/key-provider contracts; local keys refuse production. Audit metadata is recursively redacted. MCP/API tokens are shown once, stored only as keyed hashes, expire, revoke, rate-limit, and default-deny scopes outside exact workspace/form grants. `SERVICE_TOKEN` is operator-only and must never be reused for users or MCP.

Analytics accepts only named dimensions/metrics and rejects payloads, email-like values, raw IPs, tokens, and arbitrary metadata. Conversion events require analytics consent and short-lived attribution tokens are single-use. Routing uses a bounded typed AST with no arbitrary JavaScript, network, secret interpolation, or regular expressions. Agency access adds explicit grants and never bypasses workspace isolation. Report downloads verify exact workspace authorization, expiry, and checksums.
