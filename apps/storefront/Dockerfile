# syntax=docker/dockerfile:1.20
# check=error=true

FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun

FROM node:24@sha256:934240a162082fd8b8a2f90cd5114446443f1eba1c5378f6687167ca405e6584 AS build
ARG SOURCE_DATE_EPOCH=0
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}

# Keep workspace manifests in a stable layer so source changes reuse the install.
COPY package.json bun.lock vite.config.ts tsconfig.json ./
# Mirrors the workspace globs in the root package.json. --parents keeps each
# manifest at its own path, so adding a package needs no change here.
COPY --parents apps/*/package.json packages/*/package.json tooling/oxlint/package.json ./
RUN --mount=type=cache,id=bun-install-cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile

COPY . .
ENV NODE_ENV=production \
  VARLOCK_TELEMETRY_DISABLED=1
RUN ./node_modules/.bin/vp run --filter './packages/*' build \
  && ./node_modules/.bin/vp run -t storefront#build \
  && node tooling/ci/normalize-storefront-output.mjs \
    apps/storefront/.output "$SOURCE_DATE_EPOCH"

# The runtime stage carries the built output alone, so the schema's
# @import(../../) would point outside it. `flatten` copies everything
# reachable into one directory and rewrites the paths.
RUN cd apps/storefront && ../../node_modules/.bin/varlock flatten

# Bun's isolated install uses links. Resolve these before copying them alone.
# varlock starts the server, so it ships with it.
RUN mkdir -p /tmp/storefront-runtime/node_modules \
  && cp -aL apps/storefront/node_modules/react /tmp/storefront-runtime/node_modules/react \
  && cp -aL node_modules/varlock /tmp/storefront-runtime/node_modules/varlock

FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS runtime
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3001 \
  VARLOCK_TELEMETRY_DISABLED=1
WORKDIR /app
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=build --chown=node:node /app/apps/storefront/.output ./apps/storefront/.output
COPY --from=build --chown=node:node /tmp/storefront-runtime/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/storefront/.env-flat/ ./apps/storefront/

WORKDIR /app/apps/storefront
EXPOSE 3001
USER node
CMD ["node", "/app/node_modules/varlock/bin/cli.js", "run", "--", "node", ".output/server/index.mjs"]
