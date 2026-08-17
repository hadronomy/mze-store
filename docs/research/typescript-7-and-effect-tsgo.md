# TypeScript 7 and @effect/tsgo

**Date checked:** 2026-08-17

**Scope:** Replacing `@effect/language-service` with `@effect/tsgo`, and the
TypeScript 7 upgrade that change requires.

## Result

Do not move the whole repository yet. `@effect/tsgo` is the better tool and
TypeScript 7 checks most of this repository cleanly, but two packages block a
repository-wide upgrade and neither block is ours to remove.

Adopt it for `tooling/mze` alone. That package pins `typescript@7.0.2` and
`@effect/tsgo@0.36.5`; everything else stays on `typescript@^6`. ADR-0028
records that decision and its cost. Revisit the rest when `@medusajs/ui` ships
React 19 types, and when either the TypeScript JS API returns or
`tooling/oxlint` no longer needs it.

## Why @effect/tsgo is the better tool

Measured against `tooling/tsconfig.json` with the same source:

|                     | `@effect/language-service`    | `@effect/tsgo`                                                              |
| ------------------- | ----------------------------- | --------------------------------------------------------------------------- |
| Target              | patches `typescript/lib/*.js` | patches the Go `tsc` binary                                                 |
| Rules reported here | 3 kinds                       | 7 kinds, including `schemaNumber`, `lazyEffect`, `preferTypedSchemaDecoder` |
| Default severity    | warning                       | suggestion                                                                  |
| Exit code on those  | 2                             | 0, tunable per severity class                                               |
| Oxlint integration  | none                          | ships Oxlint presets for 1.77 and 1.78                                      |

The severity difference is the practical one. Under the JS service, sixteen
warnings failed the build, so adopting it meant fixing all of them first. The
Go build reports the same class of finding as a suggestion and exits 0, with
`ignoreEffectSuggestionsInTscExitCode` and its siblings to raise that when the
team wants it.

The Oxlint presets matter here too: this repository already pins `oxlint@1.78.0`
and `@effect/tsgo@0.36.5` supports exactly `1.77.0` and `1.78.0`, so the
type-aware lint path could carry Effect rules without a second type check.

Both tools patch. `@effect/tsgo` is not the way to stop editing `node_modules`.

## Requirement

`@effect/tsgo@0.36.5` supports TypeScript `7.0.2` and `7.1.0-dev.20260813.1`.
Against `typescript@6.0.3` it exits with:

```text
DiscoveryError: Unable to discover an installed typescript binary.
```

TypeScript 7.0.2 is the current `latest` tag, so the repository is one major
behind.

## What TypeScript 7 checks cleanly

Every project was checked with `tsc --noEmit -p <project>` using
`typescript@7.0.2`:

| Project                  | Errors |
| ------------------------ | ------ |
| `tooling/` (mze)         | 0      |
| `packages/db`            | 0      |
| `packages/ui`            | 0      |
| `packages/auth`          | 0      |
| `packages/territory`     | 0      |
| `packages/design-tokens` | 0      |
| `apps/storefront`        | 0      |
| `apps/medusa`            | **35** |
| `tooling/oxlint`         | **17** |

The storefront and every package pass without a single change, which is the
encouraging half of this report.

## Blocker 1: the TypeScript JS API is gone

`tooling/oxlint/src/rules/prefer-tilde-imports.ts` is built on the TypeScript
compiler API. It calls `ts.sys`, `ts.resolveModuleName`,
`ts.createModuleResolutionCache`, `ts.getParsedCommandLineOfConfigFile`, and
`ts.findConfigFile` to resolve a specifier exactly as the compiler would.

TypeScript 7 is the Go port. Its main export is the version stub:

```json
"exports": {
  ".": "./lib/version.cjs",
  "./unstable/sync": "./dist/api/sync/api.js",
  "./unstable/ast": "./dist/ast/index.js"
}
```

So `import ts from "typescript"` yields a module with no compiler API, and the
seventeen errors are all `TS2694` and `TS2339` for members that no longer exist.
A replacement API exists under `typescript/unstable/*`, named unstable by its
own authors.

Rewriting the rule against that surface is possible and is not small: the rule
is the one that enforces the `~/` convention across the repository, and its
resolution logic is the part that makes it trustworthy.

Pinning `typescript@6` for `tooling/oxlint` alone would work, because the plugin
needs the compiler as a _library_ while everything else needs it as a _checker_.
That puts two TypeScript majors in one workspace, which is a decision worth
making deliberately rather than as a side effect of this upgrade.

## Blocker 2: two React type versions across the Medusa boundary

All 34 errors in `apps/medusa` land in one file,
`src/admin/routes/settings/tax-rate-history/page.tsx`, and every one is the same
shape:

```text
error TS2786: 'Text' cannot be used as a JSX component.
  Type '@types/react@19.2.17'.ReactNode is not assignable to type 'React.ReactNode'.
    Type 'bigint' is not assignable to type 'ReactNode'.
```

The tree holds both `@types/react@18.3.31`, which `apps/medusa` pins through
`^18.3.2` for Medusa 2.18, and `@types/react@19.2.17` from the catalog for the
storefront and `packages/ui`. `@medusajs/ui` resolves against the hoisted v19
types while the Medusa program uses v18, and `ReactNode` differs between them.

This is not caused by TypeScript 7. The duplication exists today and TypeScript
6 tolerates the mismatch. TypeScript 7 reports it.

The fix belongs to the dependency: Medusa's admin is React 18 and the rest of
the repository is React 19. ADR-0012 already treats the Medusa backend as an
island, and this is that island reaching one package further than expected. The
35th error is unrelated and small, a `CreateGeoZoneDTO` shape in
`integration-tests/http/territory.spec.ts`.

## Recommendation

1. Scope the adoption to `tooling/mze`, which is the only Effect program this
   repository typechecks and the only place these diagnostics apply. It becomes
   a workspace package with its own `typescript@7` and `@effect/tsgo`. See
   ADR-0028.
2. Keep `packages/*` and `apps/*` on `typescript@^6` until blocker 2 clears
   itself, which needs no change here: `@medusajs/ui` has to publish React 19
   types.
3. Decide blocker 1 separately, because it does not depend on the upgrade:
   either rewrite `prefer-tilde-imports` against `typescript/unstable/*`, or
   accept a pinned `typescript@6` for `tooling/oxlint` and record why.

The cost of step 1 is two TypeScript majors in one workspace. That is worth
stating plainly, and it is why ADR-0028 exists rather than a line in a config.
The split follows a real boundary, and the first run of the new diagnostics paid
for itself: fourteen `schemaNumber` findings narrowed `exitCode` from
`Schema.Number` to `Schema.Int`, and `lazyEffect` removed a thunk from the
renderer interface.

## Related

- ADR-0012 — the Medusa backend is a tsc island in a Vite+ workspace.
- ADR-0027 — batch commands report phase rows, which added the `tooling types`
  check phase this report measures against.
- [Terminal output research](./effect-cli-terminal-output.md) — the pinning
  discipline this report follows.
