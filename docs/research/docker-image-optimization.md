# Docker image optimization

**Date:** 2026-08-11

**Scope:** The Medusa and Storefront images in this repository

## Result

The Storefront image has the largest clear reduction. Its runtime needs the
7.7 MB `.output` directory and the 252 KB React package from the current build.

The Medusa image needs a larger runtime dependency tree. A filtered production
install can exclude Storefront and development dependencies.

Both runtime images can use `node:24-bookworm-slim`. Keep the full Debian Node
image for the build stage until a slim-stage build passes in CI.

The first implementation must make these changes:

1. Add separate build and runtime stages.
2. Put dependency manifests before source code in the build cache.
3. Use the Debian slim Node image for each runtime stage.
4. Copy only runtime output and runtime dependencies into each final stage.
5. Run both applications as the existing `node` user.

Docker recommends multi-stage builds, small runtime images, and non-root
services. [Docker build best practices](https://docs.docker.com/build/building/best-practices/)

## Repository observations

Both Dockerfiles have one effective stage. The `base` name does not create a
runtime boundary because no later `FROM` instruction exists.

Both files run `COPY . .` before `bun install`. Any included source change
invalidates the dependency layer. Docker gives this exact JavaScript example
and puts manifests before source files. [Docker cache optimization](https://docs.docker.com/build/cache/optimize/)

Both final images contain these items:

- The complete repository source.
- All workspace development dependencies.
- Build output for shared packages.
- The Bun executable.
- Build tools that the Node runtime does not use.

The current runtime commands use Node. The repository also records Node as the
Medusa runtime in [ADR-0001](../adr/0001-medusa-under-bun-workspaces-on-node.md).

The root [`.dockerignore`](../../.dockerignore) already excludes Git data,
local dependencies, generated output, logs, and environment files. This is a
good base. Docker states that excluded files reduce context transfer and cache
invalidation. [Docker cache optimization](https://docs.docker.com/build/cache/optimize/)

The CI Docker job has no external BuildKit cache. Each GitHub runner starts
without cache from an earlier workflow run. BuildKit supports a shared external
cache across build environments. [Docker external cache documentation](https://docs.docker.com/build/cache/backends/)

## Local measurements

These measurements used the pinned repository tools on macOS arm64. Filesystem
sizes do not predict compressed Linux image sizes. They show the relative
amount of content that each boundary retains.

| Boundary                               | Local size | Notes                                                          |
| -------------------------------------- | ---------: | -------------------------------------------------------------- |
| Full workspace `node_modules`          |     1.1 GB | Current final-image dependency tree                            |
| Filtered Medusa production install     |     742 MB | `bun install --production --filter medusa`                     |
| Filtered Storefront production install |     455 MB | Still much larger than bundled output                          |
| Medusa `.medusa/server`                |     9.6 MB | Compiled backend and Operator admin                            |
| Storefront `.output`                   |     7.7 MB | Nitro server and public assets                                 |
| React package                          |     252 KB | The only non-core runtime package in current Storefront output |

The Storefront probe copied `.output` to an empty directory. The first request
failed only because `react` was absent. The same probe returned HTTP 200 after
it copied the locked React package beside the server output.

A static search of all generated `.mjs` files found no other package require.
Node core modules do not need image dependencies. Repeat this probe after each
Storefront dependency or build-tool update.

The Medusa probe found an important Bun constraint. The generated
`.medusa/server/package.json` still contains `catalog:` and `workspace:*`
references. Medusa did not copy `bun.lock` into that directory.

Medusa documents `.medusa/server` as the production output. Its normal flow
installs dependencies inside that directory. [Medusa build documentation](https://docs.medusajs.com/learn/build)

That install flow does not work unchanged for this Bun workspace. A separate
workspace production-install stage must preserve the Bun workspace layout.

## Base image choice

The floating `node:24` tag uses `buildpack-deps:bookworm`. That base includes
many common Debian development packages. The Node image maintainers describe
this default as a general-purpose build image. [Official Node image variants](https://github.com/nodejs/docker-node#image-variants)

The same maintainers describe `node:slim` as the image with only the packages
needed to run Node. [Official Node image variants](https://github.com/nodejs/docker-node#image-variants)

An OCI manifest probe on 2026-08-11 gave these compressed amd64 base sizes:

| Tag                     | Index digest                                                              | Layer total |
| ----------------------- | ------------------------------------------------------------------------- | ----------: |
| `node:24`               | `sha256:934240a162082fd8b8a2f90cd5114446443f1eba1c5378f6687167ca405e6584` |   390.0 MiB |
| `node:24-bookworm-slim` | `sha256:3638d9a6fe4030bd716be989438248074489337ba3275657f93595428be4fc03` |    76.7 MiB |

The slim base is about 80% smaller before application content. The probe summed
the amd64 layer sizes from `docker buildx imagetools inspect --raw`.

Do not select Alpine only for size. The Node maintainers state that Alpine uses
musl instead of glibc. They also warn that Debian applications can fail on
Alpine. [Official Node image variants](https://github.com/nodejs/docker-node#nodealpine)

The Medusa dependency graph contains native packages. A Debian builder and a
matching Debian slim runtime avoid a libc boundary.

## Recommended Storefront boundary

Use a full dependency stage to build the Storefront. Use a fresh Node slim
stage for runtime.

Copy these items into the runtime stage:

- `apps/storefront/.output`
- The resolved React package from the build stage
- License files required by the release process

Do not run a second full workspace install in the runtime stage. The current
Nitro output bundles every other non-core runtime package.

Copy the resolved React directory through a staging directory. Bun uses
symlinks for isolated installs, so a direct partial copy can leave a broken
link. Bun documents the central store and workspace symlink layout.
[Bun isolated-install documentation](https://bun.sh/docs/pm/isolated-installs)

Add a CI probe that starts this minimal runtime tree and requests `/`. Keep the
existing Compose smoke test as the final image check.

## Recommended Medusa boundary

Use three logical stages:

1. Install full workspace dependencies for the build.
2. Install Medusa production dependencies from the root lock file.
3. Copy production dependencies and `.medusa/server` into Node slim.

Copy every workspace manifest before either install. Medusa's Docker guide
requires all workspace manifests before installation so the package manager can
resolve the workspace graph. [Medusa Docker installation guide](https://docs.medusajs.com/learn/installation/docker)

Use a command with this shape for the production dependency tree:

```sh
bun install --frozen-lockfile --omit dev --filter medusa
```

Bun applies `--omit dev` to the root and all workspaces. Bun also supports
filtered workspace installs. [Bun install documentation](https://bun.sh/docs/pm/cli/install),
[Bun workspace documentation](https://bun.sh/docs/pm/workspaces)

Preserve these paths in the runtime stage:

- The filtered root `node_modules` store.
- `apps/medusa/node_modules` for Medusa binaries and package links.
- `packages/env` for the `@mze-store/env` workspace link and compiled output.
- `apps/medusa/.medusa/server` for the production application.

Run the existing migration command from this same final image. This keeps the
current rule that migration and server processes use one image.

Do not install dependencies from the generated Medusa manifest. Its Bun
protocol references need the root workspace and the root lock file.

## Build-cache changes

Split each build into these cache groups:

1. Copy `package.json`, `bun.lock`, and every workspace manifest.
2. Run the frozen dependency install with the existing Bun cache mount.
3. Copy source and build configuration.
4. Run the application build.

Docker states that expensive, stable steps belong before frequently changed
steps. Cache mounts keep downloaded packages available when an install layer
must run again. [Docker cache optimization](https://docs.docker.com/build/cache/optimize/)

The current Bun cache mount is correct. Keep it. Add an explicit cache ID only
if concurrent builds show cache contention.

Add a registry or GitHub Actions BuildKit cache after the stage changes pass.
External cache helps ephemeral CI runners and has less value on a persistent
local builder. [Docker cache backends](https://docs.docker.com/build/cache/backends/)

## Runtime hardening

Set `USER node` after all copies. Use `COPY --chown=node:node` for runtime
content. The official Node image already provides this user.
[Node Docker best practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md#non-root-user)

Keep `init: true` in Compose. The Node image maintainers recommend an init
process for signal forwarding. [Node Docker best practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md#handling-kernel-signals)

Pin runtime base tags to a Debian release and an OCI index digest. Docker states
that tags can change and digests give reproducible inputs. Dependabot already
tracks Docker inputs in this repository. [Docker build best practices](https://docs.docker.com/build/building/best-practices/#pin-base-image-versions)

Keep regular rebuilds with fresh base images. A digest-update pull request makes
each base change visible and lets the smoke test approve it.

## Validation gates

Record these values before and after the change:

- Compressed image size for each platform.
- Uncompressed image size.
- Cold CI build time.
- Warm CI build time.
- Number and severity of image vulnerabilities.
- Storefront and Medusa startup time.

Run these checks for each candidate image:

1. Run the current Compose smoke test.
2. Run Medusa migrations from the final Medusa image.
3. Request the Medusa health and Operator admin routes.
4. Request the Storefront home and sign-in routes.
5. Inspect the final filesystem for source, test, and environment files.
6. Make sure that the runtime user is not root.
7. Build amd64 and arm64 images if production needs both platforms.

## Decisions for the grilling session

1. Which target matters most: registry size, cold CI time, vulnerability count,
   or production startup time?
2. Does production need both amd64 and arm64 images?
3. Must operators have a shell and package manager inside a running container?
4. Can the Storefront runtime copy one locked package, or must the build bundle
   React too?
5. Must Medusa server, worker, and migration processes use one identical image?
6. What maximum image sizes will become CI gates?
7. Which registry will store the cross-run BuildKit cache?
8. Will CI create an SBOM and vulnerability report for each image?
9. How often must digest-update builds run when application code does not
   change?
10. Which production platform sets CPU, memory, read-only filesystem, and
    shutdown limits?

## Implementation order

1. Measure the current Linux images in CI.
2. Add the Storefront runtime stage and its React closure.
3. Add the Medusa filtered production dependency stage.
4. Change both runtime bases to `node:24-bookworm-slim`.
5. Add `USER node` and run the smoke test.
6. Reorder manifest and source copies for cache reuse.
7. Add the external BuildKit cache.
8. Pin tested base-image digests.

This order keeps each change measurable. It also keeps the current application
boundary and migration behavior intact.
