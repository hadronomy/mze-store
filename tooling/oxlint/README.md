# Local Oxlint rules

## Path alias lint rule

`hadronomy/prefer-tilde-imports` keeps imports local to a source surface:

- Use `./` when the importer and target are in the same directory.
- Use `~/` when the target is in another directory of the same source surface.
- Use `@mze-store/*` when the target is in another workspace package.

The rule finds the nearest `tsconfig.json` for each importer. It reads the effective `~/*` path mapping through the TypeScript API, including JSONC, `extends`, nested configs, and ordered path targets. A project without a `~/*` mapping is outside the rule scope.

The rule checks ESM imports and exports, TypeScript import types and import-equals declarations, static `import()`, and unshadowed `require()` and `require.resolve()` calls. It ignores computed module names.

Fixes use TypeScript module resolution and a filesystem fallback. The rule changes a module specifier only when the replacement resolves to the same file. It keeps query strings, fragments, quote style, and import attributes.

Run the checks with:

```sh
vp lint
vp lint --fix
vp test --run tooling/oxlint/test/index.test.ts
```

Use a named lint suppression for a rare exception. Vite+ reports unused suppressions and rejects blanket `eslint-disable` comments.

Oxlint JavaScript plugins are an alpha API. The CLI integration test protects this local plugin from upstream API changes. Keep `@oxlint/plugins` pinned to the version that Vite+ uses.

Each rule owns its Effect plan, visitors, and compiled rule in its own module. Import compiled rules from `@mze-store/oxlint/rules`. The plugin entry point only maps those rules to Oxlint names.

The directory is a private workspace package. Run these commands from the repository root:

```sh
vp run --filter @mze-store/oxlint build
vp run --filter @mze-store/oxlint check-types
vp run --filter @mze-store/oxlint test
```

Vite+ packs the plugin as ESM with declarations. The root lint config loads `@mze-store/oxlint` after the package build.

Import the compiled rule surface when another tool needs a rule value:

```ts
import { noBroadRecordTypesRule, preferTildeImportsRule } from "@mze-store/oxlint/rules";
```

## Broad record lint rule

`hadronomy/no-broad-record-types` rejects these open object shapes:

- `Record<string, unknown>`
- `Record<string, any>`
- a string-keyed index signature with an `unknown` value, such as `[key: string]: unknown`

Use a named domain type with explicit fields. Decode external input at the boundary, for example with Effect Schema. Do not widen the type to make the error disappear. The rule does not reject specific value types, such as `Record<string, number>`.
