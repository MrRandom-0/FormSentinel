FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile && pnpm --filter @formsentinel/web build
FROM node:22-alpine AS runtime
ENV NODE_ENV=production PORT=3000
WORKDIR /app
RUN corepack enable && addgroup -S formsentinel && adduser -S formsentinel -G formsentinel
COPY --from=build --chown=formsentinel:formsentinel /app /app
USER formsentinel
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O- http://127.0.0.1:3000/api/health || exit 1
CMD ["pnpm","--filter","@formsentinel/web","start"]
