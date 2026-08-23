# Odoo Bridge consumption from the Medusa CommonJS backend

Date: 2026-08-21

This note examines how the CommonJS Medusa backend must load
`@mze-store/odoo-bridge`. The bridge uses the ESM-only `effect` package.

## Decision

Use a normal static import in Medusa. Keep Effect external in both bridge
formats. Use Jest 30.4 or newer with the pinned Node 24.18.1 runtime.

```ts
import { createOdooBridge, decodeSourceRevision } from "@mze-store/odoo-bridge";
```

Do not use a dynamic import adapter. Do not bundle Effect into only the
bridge's CommonJS output.

## Runtime facts

Medusa compiles the backend as file-per-file CommonJS. A static TypeScript
import becomes a `require()` call in `.medusa/server`.

The bridge publishes separate `import` and `require` conditions. Its
CommonJS condition points to `dist/index.cjs`. Effect publishes ESM entries.

Node supports `require(esm)` when the complete ESM graph is synchronous. A
graph with top-level `await` still requires `import()`. See the
[Node 24.18.1 CommonJS documentation](https://nodejs.org/download/release/v24.18.1/docs/api/modules.html#loading-ecmascript-modules-using-require).

The pinned Effect graph is synchronous. These commands succeed under the
project's Node 24.18.1 runtime:

```text
require("effect")                         -> Effect namespace
require("@mze-store/odoo-bridge")         -> bridge namespace
require("@mze-store/odoo-bridge/effect")  -> Effect bridge namespace
```

The external build also preserves module identity across `require("effect")`
and `import("effect")`.

## Why Jest needed an upgrade

Jest runs modules through its own loader. Jest 29 rejected the external Effect
entry before Node could apply `require(esm)`.

The real Medusa suite failed during module loading with this error:

```text
Must use import to load ES Module: .../effect/dist/index.js
```

Jest 30.4 added `require(esm)` support for Node 24.9 and newer. The feature
still needs `--experimental-vm-modules`. See the
[Jest 30.4 release notes](https://github.com/jestjs/jest/releases/tag/v30.4.0).

The project pins Node 24.18.1 and already supplies that flag. Therefore, the
test runner upgrade makes tests match the production Node loader.

## Why the bridge does not bundle Effect

A CJS-only bundle works mechanically. The local experiment produced about
697 kB of CommonJS runtime code and about 1.1 MB of total bridge output.

The bundle also creates two Effect runtimes:

- The CommonJS bridge entry uses its bundled copy.
- A caller and the ESM bridge entry use the external copy.

These copies do not share all runtime identities. A `Redacted` value from one
copy failed when the other copy tried to read it. Error classes and exported
namespaces also had different identities.

This package exposes Effect values and services. A format-specific bundle
would make valid values depend on the package condition that created them.
Keeping Effect external preserves one runtime identity.

## Options

| Option                                    | Result                                                 | Decision   |
| ----------------------------------------- | ------------------------------------------------------ | ---------- |
| Static import, external Effect, Jest 30.4 | Normal source syntax and one Effect runtime            | Use        |
| Dynamic import adapter                    | Adds asynchronous construction for a loader limitation | Do not use |
| Bundle Effect in only CommonJS            | Loads in old Jest, but splits Effect identity          | Do not use |
| Convert the Medusa backend to ESM         | Conflicts with the pinned Medusa loader                | Do not use |

Vite+ delegates package dependency policy to tsdown. Dependencies remain
external by default. See the [Vite+ pack documentation](https://viteplus.dev/config/pack)
and [tsdown dependency options](https://tsdown.dev/options/dependencies).

## Constraints

Revisit this decision if one of these facts changes:

- the project uses Node older than 24.9;
- the Effect graph adds top-level `await`;
- the bridge stops publishing a CommonJS condition;
- Jest drops or changes its `require(esm)` path; or
- Medusa adopts a native ESM backend loader.

## Verification

The focused Medusa integration suite imports the Catalog Sync module. That
module now imports the bridge statically. All 17 tests passed with Jest 30.4.2.

```sh
mise exec -- node -e 'require("effect"); require("@mze-store/odoo-bridge")'
DB_PORT=32780 REDIS_PORT=32781 mise exec -- bun run test -- integration-tests/http/catalog-intake.spec.ts
```

The external bridge build remained unchanged. No Effect bundle option exists
in `packages/odoo-bridge/vite.config.ts`.
