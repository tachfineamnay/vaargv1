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
COPY packages/persistence/tsconfig.json packages/persistence/tsconfig.json
COPY packages/persistence/src packages/persistence/src
COPY packages/persistence/migrations packages/persistence/migrations
COPY apps/api/tsconfig.json apps/api/tsconfig.json
COPY apps/api/src apps/api/src
RUN pnpm --filter @vaarg/api... build && pnpm --filter @vaarg/api --prod deploy --legacy /deploy
FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /deploy ./
USER node
EXPOSE 4111
CMD ["node", "dist/main.js"]
