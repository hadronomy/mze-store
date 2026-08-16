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
RUN ./node_modules/.bin/vp run -t medusa#build

# The runtime stage carries the app alone, so the schema's @import(../../)
# would point outside it. `flatten` copies everything reachable into one
# directory and rewrites the paths. It resolves no values.
RUN cd apps/medusa && ../../node_modules/.bin/varlock flatten

FROM node:24@sha256:934240a162082fd8b8a2f90cd5114446443f1eba1c5378f6687167ca405e6584 AS production-deps
ARG SOURCE_DATE_EPOCH=0
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH}

COPY package.json bun.lock vite.config.ts tsconfig.json ./
# Mirrors the workspace globs in the root package.json. --parents keeps each
# manifest at its own path, so adding a package needs no change here.
COPY --parents apps/*/package.json packages/*/package.json tooling/oxlint/package.json ./
# A flat production tree avoids race-dependent links in Bun's isolated store.
RUN --mount=type=cache,id=bun-install-cache,target=/root/.bun/install/cache \
  bun install --frozen-lockfile --omit dev --linker=hoisted --backend=copyfile \
    --filter medusa \
    --filter '@mze-store/territory'

# Cached packages can retain broader write bits from an earlier extraction.
# Remove those bits before BuildKit records the runtime dependency layer.
RUN find /app/node_modules -type f -exec chmod go-w '{}' +

# The Medusa server does not invoke esbuild. Keep its optional build binary out
# of the runtime dependencies.
RUN rm -rf \
  /app/node_modules/.bin/esbuild \
  /app/node_modules/@esbuild \
  /app/node_modules/esbuild

FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS runtime
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=9000 \
  VARLOCK_TELEMETRY_DISABLED=1
WORKDIR /app
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=production-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/apps/medusa/package.json ./apps/medusa/package.json
COPY --from=build --chown=node:node /app/packages/territory/package.json ./packages/territory/package.json
COPY --from=build --chown=node:node /app/packages/territory/dist ./packages/territory/dist
COPY --from=build --chown=node:node /app/apps/medusa/.medusa/server ./apps/medusa/.medusa/server
COPY --from=build --chown=node:node /app/apps/medusa/.env-flat/ ./apps/medusa/.medusa/server/

WORKDIR /app/apps/medusa/.medusa/server
EXPOSE 9000
USER node
CMD ["/app/node_modules/.bin/varlock", "run", "--", "/app/node_modules/.bin/medusa", "start"]
