FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @formsentinel/mcp build
FROM node:22-alpine AS runtime
ENV NODE_ENV=production MCP_PORT=3004
WORKDIR /app
RUN addgroup -S formsentinel && adduser -S formsentinel -G formsentinel
COPY --from=build --chown=formsentinel:formsentinel /app /app
USER formsentinel
EXPOSE 3004
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O- http://127.0.0.1:3004/health || exit 1
CMD ["node","apps/mcp/dist/index.js"]
