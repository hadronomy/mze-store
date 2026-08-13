# syntax=docker/dockerfile:1.8
# check=error=true

FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun

FROM node:24@sha256:934240a162082fd8b8a2f90cd5114446443f1eba1c5378f6687167ca405e6584 AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

# Keep workspace manifests in a stable layer so source changes reuse the install.
COPY package.json bun.lock vite.config.ts tsconfig.json ./
COPY apps/medusa/package.json apps/medusa/package.json
COPY apps/storefront/package.json apps/storefront/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/env/package.json packages/env/package.json
COPY packages/territory/package.json packages/territory/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY tooling/oxlint/package.json tooling/oxlint/package.json
RUN --mount=type=cache,id=bun-install-cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile

COPY . .
ENV NODE_ENV=production
RUN ./node_modules/.bin/vp run -t medusa#build

FROM node:24@sha256:934240a162082fd8b8a2f90cd5114446443f1eba1c5378f6687167ca405e6584 AS production-deps
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

COPY package.json bun.lock vite.config.ts tsconfig.json ./
COPY apps/medusa/package.json apps/medusa/package.json
COPY apps/storefront/package.json apps/storefront/package.json
COPY packages/auth/package.json packages/auth/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/env/package.json packages/env/package.json
COPY packages/territory/package.json packages/territory/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY tooling/oxlint/package.json tooling/oxlint/package.json
RUN --mount=type=cache,id=bun-install-cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --omit dev \
    --filter medusa \
    --filter '@mze-store/env' \
    --filter '@mze-store/territory'

# The Medusa server does not invoke esbuild. Keep its optional build binary out
# of the runtime dependency store.
RUN find /app/node_modules/.bun -maxdepth 1 -type d \
  \( -name 'esbuild@*' -o -name '@esbuild+*@*' \) \
  -prune -exec rm -rf '{}' +

FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS runtime
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=9000
WORKDIR /app
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=production-deps --chown=node:node /app/apps/medusa/node_modules ./apps/medusa/node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/medusa/package.json ./apps/medusa/package.json
COPY --from=build --chown=node:node /app/packages/env/package.json ./packages/env/package.json
COPY --from=production-deps --chown=node:node /app/packages/env/node_modules ./packages/env/node_modules
COPY --from=build --chown=node:node /app/packages/env/dist ./packages/env/dist
COPY --from=build --chown=node:node /app/packages/territory/package.json ./packages/territory/package.json
COPY --from=production-deps --chown=node:node /app/packages/territory/node_modules ./packages/territory/node_modules
COPY --from=build --chown=node:node /app/packages/territory/dist ./packages/territory/dist
COPY --from=build --chown=node:node /app/apps/medusa/.medusa/server ./apps/medusa/.medusa/server

WORKDIR /app/apps/medusa/.medusa/server
EXPOSE 9000
USER node
CMD ["../../node_modules/.bin/medusa", "start"]
