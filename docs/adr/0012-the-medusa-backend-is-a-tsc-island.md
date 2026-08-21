# The Medusa backend is a tsc island in a Vite+ workspace

Both application frontends build with Vite+ and rolldown. The Medusa backend builds with the TypeScript compiler and emits CommonJS. This is a constraint imposed by Medusa, not a preference, and it is recorded because a reader who sees a rolldown monorepo with one hand-rolled exception will reasonably assume it's an oversight.

## What the backend actually does

`medusa build` calls TypeScript's compiler API directly and emits **file-per-file CJS** into `.medusa/server`. There is no bundler, no esbuild, no swc — `@swc/core` is present only to serve ts-node's transform. The admin dashboard is separate and _is_ bundled, with Vite 5, via `@medusajs/admin-bundler`.

## Why native ESM does not work

Tested against 2.18: adding `"type": "module"` makes `medusa-config.ts` native ESM. Medusa loads the file through `require()`, which fails with `ERR_REQUIRE_ESM`.

This failure does not involve the `export default` source syntax. With the existing CommonJS compiler settings, TypeScript compiles `export default` to CommonJS. Medusa reads the default export. The [Medusa 2.18.0 release notes](https://github.com/medusajs/medusa/releases/tag/v2.18.0) also use this syntax for `medusa-config.ts`.

The failure is inside **ts-node**, not Node. Medusa loads all user code — config, routes, subscribers, jobs, workflows, links, modules — through a helper in `@medusajs/utils` that is a synchronous `require()`. Node 22.12+ can `require()` ESM, but ts-node 10.9.2 intercepts every `.ts` first and refuses. Medusa's own source comment acknowledges being stuck on an unmaintained ts-node.

## Why bundling does not work either

That helper's stated purpose is _"to avoid bundling issues."_ Medusa discovers routes, subscribers, jobs, workflows, and modules by **walking the file tree at runtime**. Bundling collapses the tree and destroys the mechanism Medusa uses to find your code. A bundler here is not unsupported — it is incompatible by design.

Changing any of this means replacing Medusa's CLI, loader, and plugin resolution. That is a fork, not configuration.

## CommonJS can use synchronous ESM dependencies

The backend remains CommonJS. This does not require every runtime dependency
to publish native CommonJS.

The project pins Node 24.18.1. This Node version can load an ESM graph through
`require()` when the graph has no top-level `await`. Jest 30.4 supports the
same path on Node 24.9 and newer when the test command uses
`--experimental-vm-modules`.

Shared packages must still publish a CommonJS entry for the backend. That
entry can keep synchronous ESM dependencies external. Do not bundle one copy
of a stateful runtime into only one package format. That split creates
different runtime identities for the ESM and CommonJS entries.

## Consequences

- **Any shared package the backend imports must emit CJS.** This is a `vp pack` output-format requirement, and it is the real reason ADR-0011 keeps template markup out of shared packages.
- A shared CommonJS entry can use external ESM dependencies when Node can load their complete graph synchronously.
- Keep Jest at 30.4 or newer while the backend uses this interoperation path.
- TypeScript source uses `export default` for default exports. The compiler still emits CommonJS for the backend.
- The two apps cannot share a tsconfig. `packages/config` carries only the strictness flags both agree on.
- TypeScript does not rewrite `~/*` paths in emitted JavaScript. The Medusa build runs `tsc-alias` after `medusa build` for that reason. The admin Vite config and the Jest mapper resolve the same alias in their separate runtimes.
- Treat the boundary as stable rather than temporary. Medusa would have to drop ts-node for `tsx` or `jiti` and rewrite that loader to `await import()` before ESM is possible; neither is signalled in the 2.19 preview.
- Re-test on major Medusa, Node, or Jest upgrades. Also re-test when an external ESM graph adds top-level `await`.
