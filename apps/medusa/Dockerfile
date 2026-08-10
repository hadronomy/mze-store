FROM node:24 AS base
COPY --from=oven/bun:1.3.14 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app

COPY . .
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --frozen-lockfile

# `medusa build` emits file-per-file CJS into .medusa/server and bundles the
# admin beside it. See docs/adr/0012 for why the backend remains unbundled.
ENV NODE_ENV=production
RUN ./node_modules/.bin/vp run -t medusa#build

ENV HOST=0.0.0.0
ENV PORT=9000
EXPOSE 9000

# `medusa start` runs from the build output, not the app root — the app root is
# `medusa develop`'s working directory. ADR-0001.
WORKDIR /app/apps/medusa/.medusa/server
CMD ["../../node_modules/.bin/medusa", "start"]
