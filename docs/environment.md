# Environment guide

| Variable                          | Requirement    | Purpose                                                                                     |
| --------------------------------- | -------------- | ------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_URL`             | all            | Browser-facing web origin.                                                                  |
| `NEXT_PUBLIC_INGEST_URL`          | all            | Canonical public ingest origin; local default is `http://localhost:3001`.                   |
| `FORMSENTINEL_DATA_ADAPTER`       | all            | `local` for development/test; `postgres` for production.                                    |
| `FORMSENTINEL_LOCAL_DATA_FILE`    | local          | Shared atomic JSON state. Refused in production.                                            |
| `FORMSENTINEL_LOCAL_STORAGE_DIR`  | local          | Private mode-0600 quarantine directory. Refused in production.                              |
| `DATABASE_URL`                    | postgres       | PostgreSQL connection string.                                                               |
| `SESSION_SECRET`                  | all            | At least 32 unpredictable characters.                                                       |
| `SOURCE_HASH_SECRET`              | all            | Key for privacy-preserving source hashes; 32+ characters in production.                     |
| `SERVICE_TOKEN`                   | worker/scanner | Protects service operator endpoints; never use for users or MCP.                            |
| `MCP_TOKEN_HASH_SECRET`           | MCP            | Independent key for hashed scoped user/MCP tokens; never equal to `SERVICE_TOKEN`.          |
| `LOCAL_ENCRYPTION_KEY`            | local          | Development envelope key only; production requires a managed key-provider adapter.          |
| `TRUSTED_PROXY_HOPS`              | deployment     | Number of explicitly trusted right-most proxy hops. Default `0` ignores forwarding headers. |
| `INGEST_MAX_BODY_BYTES`           | ingest         | Absolute streamed request cap before parsing.                                               |
| `WORKER_CONCURRENCY`              | worker         | Maximum jobs claimed per poll.                                                              |
| `WORKER_LEASE_MS`                 | worker         | Lease duration before recovery.                                                             |
| `WORKER_POLL_MS`                  | worker         | Normal queue poll interval.                                                                 |
| `TURNSTILE_SECRET_KEY`            | optional       | Turnstile verifier credential. Tokens are never stored.                                     |
| `RESEND_API_KEY`, OAuth variables | reserved       | Do not activate an adapter; external delivery/OAuth remain unavailable.                     |
| `RELEASE_SHA`                     | deployment     | Returned by `/version`.                                                                     |

Only public origins belong in `NEXT_PUBLIC_*`. Secret decryptors and an object-storage adapter must be supplied by a production deployment; unavailable adapters fail honestly.
