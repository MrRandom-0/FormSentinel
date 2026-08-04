# Webhooks

Payloads use version `2025-01-01` and stable event ids. Requests include `X-FormSentinel-Signature: t=<unix>,v1=<hex>`, `X-FormSentinel-Timestamp`, `X-FormSentinel-Event`, and `X-FormSentinel-Idempotency-Key`. Verify the HMAC over `<timestamp>.<exact raw body>`, compare in constant time, enforce a five-minute timestamp window, and deduplicate by event/idempotency key.

Each destination retries independently with exponential jitter and bounded attempts. Completed event keys are terminal. Manual submission replay warns that receivers must honor idempotency. Production URL validation and DNS checks are described in `security.md`; redirects are disabled. Local transport records `captured_local` and makes no network request.
