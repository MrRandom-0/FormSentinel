FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @formsentinel/worker build
FROM node:22-alpine AS runtime
ENV NODE_ENV=production WORKER_PORT=3002
WORKDIR /app
RUN addgroup -S formsentinel && adduser -S formsentinel -G formsentinel
COPY --from=build --chown=formsentinel:formsentinel /app /app
USER formsentinel
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O- http://127.0.0.1:3002/health || exit 1
CMD ["node","apps/worker/dist/index.js"]
