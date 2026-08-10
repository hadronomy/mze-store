FROM node:24 AS base
COPY --from=oven/bun:1.3.14 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV SKIP_ENV_VALIDATION=1
# The build evaluates server modules but does not construct the lazy auth instance.
# Production database and auth values are only required at runtime.

COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

ENV NODE_ENV=production
RUN bun run build:packages && ./node_modules/.bin/vp run -t storefront#build
ENV SKIP_ENV_VALIDATION=

ENV HOST=0.0.0.0
ENV PORT=3001
EXPOSE 3001

# SSR chunks require() externals at runtime; must run from the workspace
WORKDIR /app/apps/storefront
CMD ["node", ".output/server/index.mjs"]
