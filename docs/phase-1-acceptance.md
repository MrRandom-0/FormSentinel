# Phase 1 acceptance and limitations

## Accepted flow

1. A developer signs up or logs in with a scrypt-protected password.
2. Development verification, magic-link, and reset tokens are shown explicitly because email adapters are not implemented; reserved credentials do not activate delivery.
3. Signup creates a workspace and persists onboarding progress but does not create a session until email verification succeeds.
4. An authorized member creates a form with platform, template, URL, allowed origins, expected fields, success behavior, honeypot, and notification intent.
5. The form receives a unique opaque development `POST /v1/forms/{publicFormId}/submissions` endpoint and platform-specific Integration Copilot prompt.
6. The authenticated test console posts real data to that local endpoint and reports received, validated, spam-passed, saved, notification-queued, and delivered **simulated** stages.
7. Reopening the process retains state in the configured JSON file.

## Security acceptance

Authorization uses exactly owner, administrator, developer, analyst, and viewer roles. Permission checks run server-side before tenant reads/writes. Tests cover the matrix, token/password behavior, tenant isolation, endpoint opacity, provider gating, form validation, onboarding persistence, and operational 501 responses.

## Intentional limitations

This is not a hosted submission service. Ingest submission and worker processing operations return `501 not_implemented`; email, OAuth, webhooks, scheduled monitoring, uploads, billing, and external notification delivery remain unavailable until real adapters are implemented. Reserved credentials do not activate providers in Phase 1. The PostgreSQL schema is complete for Phase 1 foundations, but the production PostgreSQL repository is Phase 2. The local JSON repository and test console throw in production.
