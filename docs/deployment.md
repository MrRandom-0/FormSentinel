# Deployment and release

The supplied containers/manifests are reviewable baselines, not evidence of a deployed service. Build immutable images from a release SHA, scan them, inject secrets through the platform, and run the migration job once before rolling services. Containers run non-root, expose liveness/readiness, receive bounded resources, and require isolated service networks. Never put usable secrets in images, Compose, CI, or manifests.

## Staging and production gate

Deploy staging, run migrations, and verify real `/ready` probes plus submission/job/delivery/Stripe replay paths. Production requires manual environment approval in the release workflow. The workflow intentionally does not report a deployed smoke without an operator-supplied target and credentials. Current production web startup/readiness is blocked because the PostgreSQL web auth/control-plane adapter is not implemented.

## Migrations and rollback

Back up and test restore first. Review locks and long-running index operations; apply migrations through the one-shot migration job. Database rollback is run-forward correction or point-in-time restore—never an automated destructive down migration. Application rollback may redeploy the previous compatible image only after checking schema compatibility.

## Coolify (self-hosted PaaS)

For Coolify deployments, see [docs/coolify.md](coolify.md). A ready-to-use Docker Compose configuration lives at `deploy/coolify/docker-compose.yml` with a corresponding environment variable template at `deploy/coolify/.env.example`.

## Secrets and networks

Use independent session, source-hash, service, MCP-hash, API-key-hash, Stripe webhook, and managed KMS credentials. Rotate through overlapping verification windows where supported and revoke old material after evidence. Public ingress reaches web/ingest only; workers and scanner remain private; PostgreSQL and storage are not public.
