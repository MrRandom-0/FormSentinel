# Public submission endpoint

POST `${NEXT_PUBLIC_INGEST_URL}/v1/forms/{publicFormId}/submissions` as JSON, URL-encoded data, or multipart FormData. Use only configured scalar field names and an optional `Idempotency-Key` of at most 200 printable characters. Successful new requests return HTTP 202 with `success`, `submission_id`, `request_id`, and `message`; same-body replay returns 200; key reuse with different content returns 409. Native HTML forms may receive the form's configured safe 303 redirect.

Browser CORS echoes only an allowed concrete origin, sets `Vary: Origin`, and permits `Content-Type` and `Idempotency-Key`. No-Origin API/native clients follow the form policy. Origin is not authentication. Handle structured `error.code`, `error.message`, optional field errors, `X-Request-Id`, and `Retry-After`. Never embed a service token or provider secret in browser code.
