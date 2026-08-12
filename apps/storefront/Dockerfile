# syntax=docker/dockerfile:1.7

FROM oven/bun:1.3.14@sha256:e10577f0db68676a7024391c6e5cb4b879ebd17188ab750cf10024a6d700e5c4 AS bun

FROM node:24@sha256:934240a162082fd8b8a2f90cd5114446443f1eba1c5378f6687167ca405e6584 AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV SKIP_ENV_VALIDATION=1

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
RUN ./node_modules/.bin/vp run --filter './packages/*' build \
  && ./node_modules/.bin/vp run -t storefront#build

# Bun's isolated install uses links. Resolve React before copying it alone.
RUN mkdir -p /tmp/storefront-runtime/node_modules \
  && cp -aL apps/storefront/node_modules/react /tmp/storefront-runtime/node_modules/react

FROM node:24-bookworm-slim@sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03 AS runtime
ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3001
WORKDIR /app
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

COPY --from=build --chown=node:node /app/apps/storefront/.output ./apps/storefront/.output
COPY --from=build --chown=node:node /tmp/storefront-runtime/node_modules ./node_modules

WORKDIR /app/apps/storefront
EXPOSE 3001
USER node
CMD ["node", ".output/server/index.mjs"]
