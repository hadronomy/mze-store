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

Oxlint JavaScript plugins are an alpha API. The CLI integration test protects this local plugin from upstream API changes. Keep the local plugin packages on the same current `@oxlint/plugins` version.

The project-specific rule owns its Effect plan, visitors, and compiled rule in its own module. Import it from `@mze-store/oxlint/rules`. The plugin entry point only maps that rule to its Oxlint name.

The directory is a private workspace package. Run these commands from the repository root:

```sh
vp run --filter @mze-store/oxlint build
vp run --filter @mze-store/oxlint check-types
vp run --filter @mze-store/oxlint test
```

Vite+ packs the plugin as ESM with declarations. The root lint config loads `@mze-store/oxlint` after the package build.

Import the compiled project rule when another tool needs its value:

```ts
import { preferTildeImportsRule } from "@mze-store/oxlint/rules";
```

## Baseline contract

`test/baseline.test.ts` runs the fixture through the real `vp lint` command.
It records one diagnostic and one fix for each supported module reference.
It also records the input byte count. The test uses local files, installed
packages, and no secrets or network access.

The first fix must match the complete expected file. A second fix must report
no change. Computed imports and a locally shadowed `require` must stay unchanged.
The filename test supplies a virtual filename and a different physical filename.
Module resolution must use the physical filename.

The `createOnce` context has this lifecycle:

| Phase                              | Available context                                    |
| ---------------------------------- | ---------------------------------------------------- |
| Static setup                       | Decoded options and services from a static `Layer`   |
| `before`                           | The current `FileContext`                            |
| Effectful and synchronous visitors | The current `FileContext`                            |
| `after`                            | The current `FileContext` until the callback returns |

`FileContext` contains the rule ID, both filenames, working directory, options,
source code, language options, settings, and report functions. It is not
available during static setup or after `after` returns.

Run the baseline with:

```sh
vp test --run tooling/oxlint/test/baseline.test.ts
```

## Certified versions

The package supports this exact cohort:

| Surface                            | Version        |
| ---------------------------------- | -------------- |
| Node                               | 24.18.1        |
| Bun package manager                | 1.3.14         |
| Effect and `@effect/vitest`        | 4.0.0-beta.107 |
| `effect-oxlint` fork               | `ef3bfa2`      |
| Local `@oxlint/plugins` dependency | 1.78.0         |
| Direct Oxlint dependency           | 1.78.0         |
| Vite+                              | 0.2.6          |
| Oxlint hosted by Vite+             | 1.75.0         |
| Plugin API hosted by Vite+         | 1.73.0         |
| TypeScript lock resolution         | 6.0.3          |

The local plugin API and the Vite+ host API are separate compatibility
surfaces. The package compiles with 1.78.0. The real Vite+ consumer test loads
the result through the 1.73.0 host API and Oxlint 1.75.0.

## Performance benchmark

`test/visitor.bench.ts` measures batches of 10,000 callbacks for
`Visitor.onSync` and `Visitor.onEffect`. It also measures the complete real Vite+
consumer fixture. Vitest records the mean, standard deviation, percentiles,
relative margin of error, and sample count.

Run the benchmark with:

```sh
vp test bench tooling/oxlint/test/visitor.bench.ts
```

CI publishes the JSON and text reports as informational artifacts. Benchmark
results do not block a pull request. The hosted runner does not provide a fixed
CPU model, so an absolute timing limit is not a portable code contract.

Run the complete certification with:

```sh
vp run --filter @mze-store/oxlint build
vp test --run tooling/oxlint/test/certification.test.ts tooling/oxlint/test/baseline.test.ts tooling/oxlint/test/index.test.ts
vp lint --fix
bun run check
```

The package [changelog](./CHANGELOG.md) records the release contract.

## Generic anti-slop rules

The root Vite+ config loads the bundled plugin from `tooling/oxlint/anti-slop/index.ts`.
It enables all ten `anti-slop/*` rules at error level. The generic dictionary
rules replace the removed broad-record rule.

Keep the copied plugin source under `tooling/oxlint/anti-slop`. Update the copy
through the `install-anti-slop` skill when the bundled rules change.
