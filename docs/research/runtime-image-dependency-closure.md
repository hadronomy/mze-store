# Runtime image dependency closure: primary-source findings

Date: 2026-08-22

This note supports the removal of the hand-maintained runtime dependency
lists in [`apps/medusa/Dockerfile`](../../apps/medusa/Dockerfile). It records
what Bun 1.3.14, Docker BuildKit, Medusa 2.18, and the alternative toolchains
guarantee. It ranks the options that make a new workspace dependency need zero
Dockerfile edits. The runtime rules come from
[ADR-0001](../adr/0001-medusa-under-bun-workspaces-on-node.md)
and [ADR-0012](../adr/0012-the-medusa-backend-is-a-tsc-island.md). The breakage
history connects to
[`odoo-bridge-commonjs-consumption.md`](./odoo-bridge-commonjs-consumption.md).

## Problem statement

The production image derives its runtime dependencies in two places, and both
are hand-written:

1. The `production-deps` stage installs with an explicit filter list:
   `bun install --frozen-lockfile --omit dev --linker=hoisted --backend=copyfile
--filter medusa --filter '@mze-store/territory'
--filter '@mze-store/odoo-bridge'`
   ([Dockerfile lines 43-47](../../apps/medusa/Dockerfile)).
2. The `runtime` stage copies each workspace package by name:
   `packages/territory/{package.json,dist}` and
   `packages/odoo-bridge/{package.json,dist}`
   ([Dockerfile lines 81-84](../../apps/medusa/Dockerfile)).

The two lists must stay consistent with each other and with
[`apps/medusa/package.json`](../../apps/medusa/package.json), which declares
`workspace:*` dependencies on `@mze-store/design-tokens`,
`@mze-store/odoo-bridge`, and `@mze-store/territory`. A miss on either list
surfaces only when the Compose stack boots. The [Docker smoke test job in
CI](../../.github/workflows/ci.yml) runs
`docker compose up --detach --build --wait`. The migrate container then exits
when Node cannot resolve a dangling symlink under
`node_modules`.

Commit `c8b0dc2` (fix(catalog): use static Odoo bridge imports) made
`@mze-store/odoo-bridge` a static import of the compiled backend. That commit
touched `apps/medusa/package.json` but not the Dockerfile. The working tree
carries the follow-up fix that adds the package to both lists. The failure mode
is real and recent.

The manual lists also encode knowledge that no manifest states. The backend
declares `@mze-store/design-tokens` as a production dependency, yet the runtime
image does not copy it. That is correct today because the only use is a
`require.resolve("@mze-store/design-tokens/brand/icon.svg")` at admin build
time in
[`src/admin/favicon.ts`](../../apps/medusa/src/admin/favicon.ts). A reader who
derives the closure from `dependencies` alone reaches a different answer than
the Dockerfile encodes.

Sources: the [Dockerfile](../../apps/medusa/Dockerfile), the `c8b0dc2` commit
history in this repository, and the
[ci.yml docker-integration job](../../.github/workflows/ci.yml).

## What Bun 1.3.14 already guarantees

I verified the following against the exact pinned version (`bun 1.3.14`). The
evidence combines minimal fixtures with a reproduction of the production-deps
install from this repository's real manifests and `bun.lock`.

**A name filter already closes over workspace dependencies, transitively.**
In a fixture, `app` depends on workspace `b`, and `b` depends on workspace
`d`. The command `bun install --filter app` installed links for both `b` and
`d` plus their registry dependencies, and skipped an unrelated workspace `c`.
Filtering only the leaf `b` installed `d` but not `app`: the closure follows
dependencies, not dependents. Bun documents the relation explicitly as filter
patterns: `foo...`
selects "foo and the workspaces it depends on, directly or transitively".

**`--omit dev` applies across the whole workspace graph.** A `devDependencies`
entry of an included workspace package stayed out of the tree.

**On the real repository manifests, the extra filters are redundant.** I
copied the same set the Dockerfile copies into a scratch directory: the root
manifests, all twelve `**/package.json` files, and `bun.lock`. I then ran the
production-deps command twice, once with the current three filters and once
with only `--filter medusa`. Both produced identical top-level trees (597
entries, byte-identical listing), including `@mze-store` symlinks for
design-tokens, odoo-bridge, and territory. Commit `cab4cb2` chose the hoisted
linker for layer
reproducibility. The filter list grew alongside it, not because the linker
needs it.

**Workspace packages stay symlinks under `hoisted` + `copyfile`.** In every
install, `node_modules/@mze-store/<pkg>` remained a relative symlink such as
`b -> ../pkgs/b`. Bun's own documentation states why. The copyfile backend
applies to registry extraction, while "`link:` dependencies do not use this
backend; Bun installs them as a single symlink to the linked directory."
Workspace dependencies are `link:` dependencies. This single fact creates the
second manual list: the copied `node_modules` dangles unless the runtime stage
also materializes each symlink target's manifest and built output.

Sources: [bun --filter](https://bun.com/docs/pm/filter),
[bun install](https://bun.com/docs/pm/cli/install) (backends and `link:`
behavior), the commit message of `cab4cb2` in this repository, and the local
experiments described above.

## Option 1: one filter plus generic glob COPY

**What it is.** Collapse the install filters to the single documented form
(`--filter 'medusa...'`) and replace the per-package `COPY` lines with parent-
preserving globs over `packages/*`.

**Primary-source evidence.** Bun's filtering documentation gives `foo...` for
"foo and the workspaces it depends on". Docker's `COPY --parents` preserves
parent directories of matched sources, supports wildcards, and supports the
`./` marker to limit how much path is preserved. This Dockerfile already uses
the pattern family for manifests (`COPY --parents **/package.json ./`).

**Applied here.** Delete four `COPY` lines and replace them with one glob pair
that materializes every workspace package manifest and its `dist`:

```dockerfile
COPY --parents --from=build \
  /app/packages/*/package.json \
  /app/packages/*/dist \
  /
```

`--parents` mirrors the source stage's absolute prefix onto the destination,
so the copies land at `/app/packages/*/`. Two semantics matter and both are
fixture-verified against BuildKit with the dockerfile 1.20 frontend: stage-
relative sources (`packages/*/package.json`) combined with `--from` match
nothing silently, and the destination must be `/` for the mirrored tree to
land at `/app/packages`. Adding `@mze-store/example` as a backend dependency
then needs zero Dockerfile edits. The install closure picks it up, and the
glob carries its manifest and dist regardless of whether any link points at
it.

**Trade-offs.**

- Reproducibility: unchanged. The inputs to each layer stay deterministic.
- Lockfile fidelity: unchanged. Bun still installs everything from
  `--frozen-lockfile`.
- Image size: the image now ships manifests and dist of packages the backend
  never imports (`auth`, `db`, `ui`, `config`). These are small libraries.
  The cost is measured in kilobytes to low megabytes.
- Toolchain rule: no second package manager or task runner involved.
- Migration cost: minimal, and the change fails loudly if the dist glob ever
  matches nothing. One caveat needs a build check. A workspace package without
  a `dist` entry does not match the glob. That is harmless while at least one
  match exists.
- Scope caveat: the glob assumes shared runtime packages live under
  `packages/`. A future workspace dependency placed elsewhere needs either a
  wider pattern or Option 2.

## Option 2: dereference the links after the production install

**What it is.** Run the production install after the build (so `dist` exists),
then replace the workspace symlinks with physical copies inside
`node_modules`. The runtime stage then copies exactly one directory and keeps
no package list at all.

**Primary-source evidence.** POSIX `cp -aL` dereferences symlinks while
preserving timestamps. I verified the result end to end on the fixture. After
`cp -aL node_modules nm-flat` and deletion of the original workspace source
directories, Node resolved `require("b")` and the transitive `require("d")`
from inside `nm-flat`.

**Applied here.** Base `production-deps` on `build` instead of a fresh image so
the built `dist` directories exist, run the same install command with only
`--filter medusa...`, then dereference:

```dockerfile
RUN cd /app/node_modules/@mze-store \
  && for link in *; do \
       target="$(readlink "$link")" \
       && rm "$link" && cp -a "../${target#../}" "$link"; \
     done
```

Only whatever Bun actually linked gets copied, so nothing depends on directory
naming conventions anywhere in the tree. The existing `chmod go-w` sweep still
applies before BuildKit records the layer.

**Trade-offs.**

- Reproducibility: preserved with `-a` (timestamps survive), but the
  reproducibility workflow gates digests and must confirm the new layer.
- Lockfile fidelity: unchanged. Dereferencing is a pure filesystem operation
  after a frozen-lockfile install.
- Image size: linked packages ship their full source directories (`src`,
  `test`) unless pruned generically afterwards. These packages are small.
- Toolchain rule: satisfied. The change uses plain POSIX shell inside the
  existing stages.
- Migration cost: moderate. Stage ordering changes, and the loop is more
  logic than Option 1's single instruction. In exchange, no naming convention
  anywhere can silently break the image.

## Option 3: Bun self-contained workspaces (`workspaces.selfContained`)

**What it is.** A hoisted-linker mode where one workspace becomes a hoisting
barrier and its `node_modules` holds physical copies of everything registry-
installed beneath it.

**Primary-source evidence.** Bun documents the setting in both spellings
(`installConfig.hoistingLimits` in the workspace manifest, or
`workspaces.selfContained` in the root). The implementing PR, oven-sh/bun
#40014, merged on 2026-08-22 and states the boundary precisely: the
barrier covers registry packages, while "other workspaces it depends on...
stay symlinks", and the test asserts the workspace symlink remains present.

**Fit here.** Not usable on the pinned 1.3.14. Both spellings fail on it with
`error: b@workspace:* failed to resolve` in my fixture. On a newer Bun, the
setting drops the root `node_modules` from the runtime stage. It keeps the
need to materialize the workspace targets, because sibling workspace links
persist by design.

It combines naturally with Option 2 rather than replacing anything. Bun also
has no deploy-style primitive today. A 2025 feature request
asking for exactly that
([oven-sh/bun #25114](https://github.com/oven-sh/bun/issues/25114)) confirms
the gap from the maintainers' issue tracker.

Sources: [Bun workspaces docs](https://bun.com/docs/pm/workspaces),
[oven-sh/bun #40014](https://github.com/oven-sh/bun/pull/40014),
[oven-sh/bun #25114](https://github.com/oven-sh/bun/issues/25114), and the
local fixture failure on 1.3.14.

## Option 4: pnpm deploy

**What it is.** pnpm's canonical answer: `pnpm --filter <pkg> --prod deploy
<dir>` produces a portable directory whose isolated `node_modules` contains
all dependencies "including dependencies from the workspace", documented with
a Docker multi-stage example.

**Fit here.** Blocked twice. First, the repository forbids a second package
manager, and pnpm is exactly that. Second, the mechanism regressed upstream.
Since pnpm 11.19.0, deploy symlinks local workspace dependencies back
into the monorepo instead of injecting copies. The copied deploy directory
then fails with `Cannot find module`
([pnpm #13754](https://github.com/pnpm/pnpm/issues/13754),
labeled regression). The canonical solution is not currently a stable target
even where pnpm is allowed.

Sources: [pnpm deploy](https://pnpm.io/cli/deploy),
[pnpm/pnpm #13754](https://github.com/pnpm/pnpm/issues/13754).

## Option 5: Yarn workspaces focus

**What it is.** `yarn workspaces focus --production` runs an install "as if
the specified workspaces (and all other workspaces they depend on) were the
only ones in the project".

**Fit here.** The same second-toolchain rule blocks it, and focus is weaker
than it looks. It produces a subset install of the normal workspace layout,
not a portable deployment directory. The symlink structure and the resulting
COPY problem remain.

Source: [yarn workspaces focus](https://yarnpkg.com/cli/workspaces/focus).

## Option 6: trace the entry point with @vercel/nft

**What it is.** `@vercel/nft` computes "exactly which files (including
`node_modules`) are necessary for the application runtime" through static
analysis of `import`, `require`, and `fs` usage. Next.js builds its
`output: 'standalone'` deployments on it, copying traced files into a folder
deployable without `node_modules`.

**Fit here.** Technically reachable, structurally poor. Medusa discovers
routes, subscribers, jobs, workflows, and modules by walking the file tree at
runtime. A static trace of `.medusa/server` therefore under-collects by
construction. [ADR-0012](../adr/0012-the-medusa-backend-is-a-tsc-island.md)
records that this loader behavior makes bundling "incompatible by design", and
the same property weakens tracing.

nft mitigates dynamic patterns with conservative glob
emission, but correctness then rests on analysis guesses rather than on the
lockfile. Reproducibility survives only as far as the tracer stays
deterministic. Lockfile fidelity is lost outright: the image content stops
being "what bun.lock resolved" and becomes "what the analyzer saw". Cost is a
new build-time dependency and a custom pipeline for a problem Options 1 and 2
solve with shell built-ins.

Sources: [@vercel/nft README](https://github.com/vercel/nft),
[Next.js output file tracing](https://nextjs.org/docs/app/api-reference/config/next-config-js/output),
[ADR-0012](../adr/0012-the-medusa-backend-is-a-tsc-island.md).

## Option 7: bundle the server or compile a single executable

**What it is.** Ship one JavaScript bundle via esbuild/rolldown, or one binary
via `bun build --compile`.

**Evidence against.** Three independent blockers:

1. Medusa compiles file-per-file CommonJS with `tsc` by design. The standalone
   build PR (#9496) states the goal as mimicking the project structure in the
   output. [ADR-0012](../adr/0012-the-medusa-backend-is-a-tsc-island.md)
   records that Medusa's synchronous `require()` loader
   plus runtime file-tree discovery destroys bundled layouts: "A bundler here
   is not unsupported — it is incompatible by design."
2. `bun build --compile` embeds the Bun runtime, while this repository runs
   processes under Node 24 by decision
   ([ADR-0001](../adr/0001-medusa-under-bun-workspaces-on-node.md)).
3. The compiler route has known gaps for exactly this shape of application.
   Non-statically-analyzable dynamic imports are impossible to include
   ([oven-sh/bun #11732](https://github.com/oven-sh/bun/issues/11732)), and
   native modules fail at load
   ([oven-sh/bun #17312](https://github.com/oven-sh/bun/issues/17312)).

Medusa's plugin/module resolution loads configured packages dynamically at
boot, which sits directly in the dynamic-import gap. This route is not viable
without forking Medusa's CLI and loader.

Sources: [medusajs/medusa #9496](https://github.com/medusajs/medusa/pull/9496),
[Bun single-file executables](https://bun.com/docs/bundler/executables),
[ADR-0012](../adr/0012-the-medusa-backend-is-a-tsc-island.md),
[ADR-0001](../adr/0001-medusa-under-bun-workspaces-on-node.md).

## Why Medusa's official standalone flow does not apply

Medusa's deployment guide says to run `cd .medusa/server && npm install &&
npm run predeploy && npm run start`. The guide describes `.medusa/server` as
containing "`package.json` and a lock file: the dependencies required to run
the Medusa
application in production." The pinned compiler source shows what actually
happens. `#copyPkgManagerFiles` copies the project root `package.json`
verbatim, copies only `yarn.lock`, `pnpm.lock`, and `package-lock.json`, and
never touches `bun.lock` or rewrites protocols.

In this repository the emitted
`apps/medusa/.medusa/server/package.json` is a byte-for-byte
copy of the app manifest, still carrying `catalog:` and `workspace:*`
specifiers. No installer can resolve those outside the monorepo context, so
the official flow cannot produce the runtime closure here. The Dockerfile's
root-level install approach exists because of this upstream limitation, not in
spite of guidance.

Sources: [Build Medusa Application](https://docs.medusajs.com/learn/build),
[General Medusa Application Deployment Guide](https://docs.medusajs.com/learn/deployment/general),
the pinned
[`compiler.ts`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/framework/src/build-tools/compiler.ts)
at tag `b574ef20` (Medusa 2.18.0), and the local build output.

## Ranked recommendation

1. **Option 1 — collapse filters, generic glob COPY. Viable today.** Smallest
   diff that removes both hand-maintained lists. One filter flag
   (`--filter 'medusa...'`) covers the install closure forever, verified
   against the real lockfile on 1.3.14. One `COPY --parents` glob covers every
   workspace package. The cost is kilobytes of unused manifests and dist. Do
   this first. It removes the failure mode that hit `c8b0dc2` with zero
   ongoing discipline.
2. **Option 2 — dereference links post-install. Viable today.** Makes no
   assumption about directory names, unlike globs, and shrinks the
   runtime stage to a single `node_modules` copy. Slightly more logic and a
   reproducibility-gate re-check. Choose this over Option 1 if the team
   prefers structural guarantees over convention-scoped ones, or combine: glob
   now, dereference when someone next touches the stages.
3. **Guard rail alongside either.** A cheap CI assertion compares the
   workspace closure Bun computes from `bun.lock` against what the runtime
   stage materializes. Any future silent gap then becomes a loud, early
   message. It stays optional once Option 1 or Option 2 lands. Until then, it
   converts any silent gap into an early, named failure.
4. **Option 3 — `selfContained` after a Bun upgrade. Watch, do not adopt.**
   Merged upstream on 2026-08-22, absent from the pinned 1.3.14, and it keeps
   workspace links as symlinks anyway. Revisit as a companion to Option 2 on
   the next deliberate Bun bump, since it drops the root `node_modules` from
   the runtime stage entirely.
5. **Option 6 — @vercel/nft tracing. Possible, poor fit.** Static tracing
   fights a framework that resolves code by walking the tree at boot, and it
   trades lockfile fidelity for analyzer guesses. Not worth the pipeline.
6. **Options 4 and 5 — pnpm deploy, yarn focus. Not viable here.** Both need a
   forbidden second package manager, and pnpm deploy carries an active
   upstream regression of its core promise.
7. **Option 7 — bundling or single executable. Not viable.** Medusa's loader
   rejects bundles by design. The compile route targets the wrong runtime for
   this repository, and it hits documented compiler gaps for dynamic imports
   and native modules.

These conclusions fix the mechanism, not the final Dockerfile text. Land
Option 1 behind the existing reproducibility gates
and the Docker smoke test. Then decide between keeping the glob form and
moving to dereferenced copies the next time the stages change.
