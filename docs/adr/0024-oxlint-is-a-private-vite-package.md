# The Oxlint plugin is a private Vite+ package

The repository has one project-specific Effect-based Oxlint rule. It needs the
forked `effect-oxlint` runtime and TypeScript at runtime. A loose file under
`tooling/` does not declare that boundary or own its build. Generic anti-slop
rules live in a copied source plugin beside the package and load directly from
the root Vite+ config.

## Decision

`tooling/oxlint` is a private workspace package named `@mze-store/oxlint`.
Vite+ packs it as ESM with declarations. The package keeps the Effect runtime,
the forked `effect-oxlint`, TypeScript, and Oxlint plugin types in its own
manifest.

The source layout is:

```text
tooling/oxlint/
├── anti-slop/
├── src/index.ts
├── src/rules/index.ts
├── src/rules/prefer-tilde-imports.ts
└── test/
```

`src/rules/index.ts` is the rule barrel. It exports the compiled rule values
and the path resolver used by tests. `src/index.ts` owns only the Oxlint plugin
map and its `hadronomy` namespace.

The package exposes two explicit entry points:

```ts
import plugin from "@mze-store/oxlint";
import { preferTildeImportsRule } from "@mze-store/oxlint/rules";
```

The root Vite+ configuration loads `@mze-store/oxlint`. The MZE task graph
builds the package before lint, check, and workspace test commands. The build
output stays ignored and never enters source control.

## TypeScript and module resolution

The package uses the shared ESM preset with bundler resolution. The packaged
source imports are extensionless, such as `./rules`. The copied anti-slop
source is loaded directly by Vite+ and keeps its `.ts` imports. Its no-emit
type check enables `allowImportingTsExtensions` for that direct-loading path.

## Consequences

- The package has one manifest, one TypeScript config, and one Vite+ pack config.
- Root lint uses the same packed entry that another workspace package imports.
- A direct `vp lint` needs an existing package build. `bun run mze lint` builds
  it first.
- The rules barrel gives a stable import path without a dynamic registry.
- ESM-only output matches the Oxlint JavaScript plugin loader.

## Evolution path

Keep the current `createOnce` and synchronous visitor boundary while the
`effect-oxlint` fork evolves. Add a new package entry only when a real consumer
needs it. A future `recommended` preset can live under `src/presets.ts`; do not
add dynamic rule discovery or a generic registry first.

## Related

- [Effect tooling decision](./0023-effect-supervises-repository-commands.md)
- [Effect Oxlint package review](../research/effect-oxlint-plugin.md)
- [Effect Oxlint performance design](../research/effect-oxlint-performance-design.md)
