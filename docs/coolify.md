# Deploying FormSentinel with Coolify

This guide covers deploying the full FormSentinel stack using [Coolify](https://coolify.io), an open-source, self-hosted PaaS that supports Docker Compose deployments natively.

## Prerequisites

- Coolify v4+ installed and running
- A server with at least 4 GB RAM and 2 vCPUs (all five services plus PostgreSQL)
- DNS records pointing your domain(s) to the Coolify server
- The FormSentinel repository connected as a source in Coolify

## Architecture overview

The Coolify deployment runs the following services:

| Service  | Port | Network  | Description                        |
|----------|------|----------|------------------------------------|
| web      | 3000 | public   | Next.js dashboard and API          |
| ingest   | 3001 | public   | Hono-based form submission ingress |
| worker   | -    | internal | Background job processor           |
| scanner  | -    | internal | Form vulnerability scanner         |
| mcp      | -    | internal | MCP tool server                    |
| postgres | 5432 | internal | PostgreSQL 17 database             |
| migrate  | -    | internal | One-shot migration job             |

Only `web` and `ingest` are exposed publicly. All other services communicate over an internal Docker network that is not reachable from outside the stack.

## Setup steps

### 1. Add the repository in Coolify

1. Go to **Sources** in Coolify and connect your Git provider (GitHub, GitLab, etc.)
2. Add the FormSentinel repository

### 2. Create a new service

1. Navigate to **Projects** and create (or select) a project
2. Click **New Resource** and choose **Docker Compose**
3. Select the FormSentinel repository and branch (e.g., `main`)
4. Set the **Docker Compose Location** to: `docker-compose.coolify.yml`

### 3. Configure environment variables

1. Open the **Environment Variables** tab for the service
2. Refer to `deploy/coolify/.env.example` for all available variables
3. At minimum, set these **required** secrets:

   ```
   POSTGRES_PASSWORD=<strong-random-password>
   SESSION_SECRET=<32+-random-chars>
   SOURCE_HASH_SECRET=<32+-random-chars>
   SERVICE_TOKEN=<32+-random-chars>
   MCP_TOKEN_HASH_SECRET=<32+-random-chars>
   LOCAL_ENCRYPTION_KEY=<32+-random-chars>
   API_KEY_HASH_SECRET=<32+-random-chars>
   NEXT_PUBLIC_APP_URL=https://your-domain.com
   NEXT_PUBLIC_INGEST_URL=https://ingest.your-domain.com
   TRUSTED_HOSTS=your-domain.com
   ```

4. Mark all secret values as **Secret** in Coolify (eye icon) to prevent exposure in logs

### 4. Configure domains

In Coolify's service settings:

- Assign your primary domain to the `web` service on port 3000
- Assign your ingest subdomain to the `ingest` service on port 3001
- Coolify automatically provisions TLS certificates via Let's Encrypt

### 5. Deploy

Click **Deploy**. Coolify will:

1. Build all service images from the monorepo Dockerfiles
2. Start PostgreSQL and wait for it to be healthy
3. Run the `migrate` service (applies database migrations)
4. Start all application services after migration completes

## Networking

The compose file defines two networks:

- **frontend** - accessible from Coolify's reverse proxy (Traefik). Only `web` and `ingest` are attached.
- **backend** (internal) - isolated network for inter-service communication. All services including PostgreSQL are attached.

Worker, scanner, and MCP services cannot be reached from outside the stack. PostgreSQL is never exposed publicly.

## Health checks

Every service includes a health check that Coolify monitors:

- `web`: `GET /api/health` on port 3000
- `ingest`: `GET /health` on port 3001
- `worker`: `GET /health` on port 3002
- `scanner`: `GET /health` on port 3003
- `mcp`: `GET /health` on port 3004
- `postgres`: `pg_isready`

If a health check fails, Coolify will restart the container according to the `restart: unless-stopped` policy.

## Resource limits

Default resource limits per service:

| Service  | CPU   | Memory |
|----------|-------|--------|
| web      | 1.0   | 1 GB   |
| ingest   | 1.0   | 512 MB |
| worker   | 1.0   | 512 MB |
| scanner  | 0.5   | 256 MB |
| mcp      | 0.5   | 256 MB |
| postgres | 1.0   | 512 MB |

Adjust these in Coolify's service settings or by modifying `deploy.resources.limits` in the compose file for your workload.

## Migrations

Database migrations run automatically on every deployment via the `migrate` service. This service:

- Depends on PostgreSQL being healthy
- Runs `pnpm db:migrate` (Drizzle Kit migrations)
- Exits after completion (restart policy: `no`)
- All other services wait for migration to complete before starting

For manual migration control, you can exec into a running container:

```bash
docker exec -it <web-container> pnpm db:migrate
```

## Backups

Configure PostgreSQL backups in Coolify:

1. Go to the `postgres` service settings
2. Enable scheduled backups (Coolify supports S3-compatible backup targets)
3. Test restore procedures before relying on them

Alternatively, use `pg_dump` via a cron job on the host:

```bash
docker exec <postgres-container> pg_dump -U formsentinel formsentinel > backup.sql
```

## Updating

To deploy a new version:

1. Push changes to the configured branch
2. Coolify will detect the update (if webhooks are configured) or manually trigger a redeploy
3. Images are rebuilt, migrations run, and services restart with zero-downtime if Coolify's rolling update is enabled

## Troubleshooting

### Services fail to start after migration

Check the `migrate` service logs in Coolify. Common causes:
- `DATABASE_URL` is incorrect or PostgreSQL is not ready
- Migration files are incompatible with the current schema (requires manual intervention)

### Web returns 503

The web app currently requires the PostgreSQL auth/control-plane adapter to be fully wired for production mode. If you see auth-related errors, verify:
- `FORMSENTINEL_AUTH_ADAPTER=postgres` is set
- Database migrations completed successfully
- All required secrets are configured

### Connection refused between services

Ensure services reference each other by Docker service name (e.g., `postgres`, not `localhost`). The `DATABASE_URL` in the compose file uses `postgres` as the hostname automatically.

### Out of memory

Increase the memory limits in the compose file or Coolify's resource settings. The web service with Next.js may need more than 1 GB under heavy load.

## Security notes

- All containers run as non-root user (`formsentinel`)
- Containers use `read_only: true` filesystem with `/tmp` as tmpfs
- `no-new-privileges` security option is enabled
- The backend network is marked as `internal` (no external routing)
- Never commit real secrets to the repository
- Rotate secrets through Coolify's UI; update one at a time and verify health checks pass
