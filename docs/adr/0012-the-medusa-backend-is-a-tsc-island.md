# The Medusa backend is a tsc island in a Vite+ workspace

Everything in this repo builds with Vite+ and rolldown except the Medusa backend, which builds with the TypeScript compiler and emits CommonJS. This is a constraint imposed by Medusa, not a preference, and it is recorded because a reader who sees a rolldown monorepo with one hand-rolled exception will reasonably assume it's an oversight.

## What the backend actually does

`medusa build` calls TypeScript's compiler API directly and emits **file-per-file CJS** into `.medusa/server`. There is no bundler, no esbuild, no swc — `@swc/core` is present only to serve ts-node's transform. The admin dashboard is separate and _is_ bundled, with Vite 5, via `@medusajs/admin-bundler`.

## Why ESM does not work

Tested against 2.18: switching the backend to `"type": "module"`, `NodeNext`, and `export default` fails immediately with `ERR_REQUIRE_ESM`.

The failure is inside **ts-node**, not Node. Medusa loads all user code — config, routes, subscribers, jobs, workflows, links, modules — through a helper in `@medusajs/utils` that is a synchronous `require()`. Node 22.12+ can `require()` ESM, but ts-node 10.9.2 intercepts every `.ts` first and refuses. Medusa's own source comment acknowledges being stuck on an unmaintained ts-node.

## Why bundling does not work either

That helper's stated purpose is _"to avoid bundling issues."_ Medusa discovers routes, subscribers, jobs, workflows, and modules by **walking the file tree at runtime**. Bundling collapses the tree and destroys the mechanism Medusa uses to find your code. A bundler here is not unsupported — it is incompatible by design.

Changing any of this means replacing Medusa's CLI, loader, and plugin resolution. That is a fork, not configuration.

## Consequences

- **Any shared package the backend imports must emit CJS.** This is a `vp pack` output-format requirement, and it is the real reason ADR-0011 keeps template markup out of shared packages.
- The two apps cannot share a tsconfig. `packages/config` carries only the strictness flags both agree on.
- Treat the boundary as stable rather than temporary. Medusa would have to drop ts-node for `tsx` or `jiti` and rewrite that loader to `await import()` before ESM is possible; neither is signalled in the 2.19 preview.
- Re-test on major Medusa upgrades. The experiment is cheap — flip `type`, `module`, and the config export, then run `medusa build`.
