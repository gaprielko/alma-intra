# API + web image for staging and production: the API also serves the built SPA. Build from the
# repo root:
#   docker build -f apps/api/Dockerfile -t alma-intra .
# The same image is promoted from staging to production; only the environment differs.

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile --filter @intra/api... --filter @intra/web...
RUN pnpm turbo run build --filter=@intra/api... --filter=@intra/web
# Only the built output, in the monorepo's own layout: `apps/api` (dist and migrations),
# `packages/shared` (dist, which `@intra/shared` points at) and the web bundle.
RUN mkdir -p /out/apps/api /out/packages/shared \
  && cp -r apps/api/package.json apps/api/dist /out/apps/api/ \
  && cp -r apps/api/src/db/migrations /out/apps/api/dist/db/migrations \
  && cp -r packages/shared/package.json packages/shared/dist /out/packages/shared/ \
  && cp -r apps/web/dist /out/web

# Production dependencies, from `pnpm-lock.yaml` and nothing else (`--frozen-lockfile` fails the
# build instead of resolving again). Only the manifests are copied in, so this layer is rebuilt when
# the lockfile or a manifest changes, not on every source change.
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --prod --filter @intra/api...

FROM node:22-slim
ENV NODE_ENV=production WEB_DIST_DIR=/app/web
WORKDIR /app/apps/api
# node_modules are pnpm's isolated layout: the store in /app/node_modules/.pnpm and relative
# symlinks from each package into it (and `@intra/shared` to /app/packages/shared), so the three
# folders must keep their places under /app.
COPY --from=build --chown=node:node /out /app
COPY --from=prod-deps --chown=node:node /repo/node_modules /app/node_modules
COPY --from=prod-deps --chown=node:node /repo/apps/api/node_modules ./node_modules
COPY --from=prod-deps --chown=node:node /repo/packages/shared/node_modules /app/packages/shared/node_modules
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://localhost:'+(process.env.API_PORT||3100)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Migrations first: a failed migration stops the deploy and the previous container keeps running.
# The server itself never gets the admin URL: intra_admin owns the tables, and the append-only
# audit trail holds only because intra_app cannot delete from it.
CMD ["sh", "-c", "node dist/db/migrate.cli.js && exec env -u DATABASE_ADMIN_URL node dist/main.js"]
