# syntax=docker/dockerfile:1
FROM node:24-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.15.0 --activate
FROM base AS deps
COPY pnpm-workspace.yaml pnpm-lock.yaml .npmrc package.json turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/persistence/package.json packages/persistence/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile
FROM deps AS build
COPY packages/shared/tsconfig.json packages/shared/tsconfig.json
COPY packages/shared/src packages/shared/src
COPY apps/web/tsconfig.json apps/web/tsconfig.json
COPY apps/web/next.config.mjs apps/web/next.config.mjs
COPY apps/web/next-env.d.ts apps/web/next-env.d.ts
COPY apps/web/src apps/web/src
RUN pnpm --filter @vaarg/web... build
FROM node:24-alpine AS runtime
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --chown=node:node deploy/web/entrypoint.mjs ./entrypoint.mjs
USER node
EXPOSE 3000
CMD ["node", "entrypoint.mjs"]
