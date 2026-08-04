FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @formsentinel/ingest build
FROM node:22-alpine AS runtime
ENV NODE_ENV=production INGEST_PORT=3001
WORKDIR /app
RUN addgroup -S formsentinel && adduser -S formsentinel -G formsentinel
COPY --from=build --chown=formsentinel:formsentinel /app/apps/ingest/dist ./dist
COPY --from=build --chown=formsentinel:formsentinel /app/node_modules ./node_modules
COPY --from=build --chown=formsentinel:formsentinel /app/apps/ingest/package.json ./package.json
USER formsentinel
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O- http://127.0.0.1:3001/health || exit 1
CMD ["node","dist/index.js"]
