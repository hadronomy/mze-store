# `effect-oxlint` review

**Date checked:** 2026-08-12

**Repository:** [`mpsuesser/effect-oxlint`](https://github.com/mpsuesser/effect-oxlint)

**Revision:** [`v0.3.3` / `37ea33b`](https://github.com/mpsuesser/effect-oxlint/tree/v0.3.3)

**Scope:** Use of Effect v4 in the repository Oxlint JavaScript plugin at
[`tooling/oxlint/src/index.ts`](../../tooling/oxlint/src/index.ts).

## Result

`effect-oxlint` is a useful Effect-first rule authoring library. It gives
rules typed context access, `Option`-based AST matchers, effectful visitors,
diagnostic builders, and test helpers.

Do not replace the current MZE rule with it without an adapter. The current
rule uses Oxlint's `createOnce` API through `eslintCompatPlugin`. The package's
main rule builder returns the slower, per-file `create` API and runs an
`Effect.runSync` call for every visitor event. The package also does not expose
Oxlint's `physicalFilename`, which the current rule uses for module resolution.

The recommended path is a measured pilot. Pin the package exactly, keep the
current Oxlint integration test, and preserve the existing `createOnce` path
until an Effect adapter supports that lifecycle. Use the package's AST,
diagnostic, and testing modules first. Migrate the rule workflow only after a
benchmark and a physical-filename compatibility test pass.

This is a fit for a later, narrow change. It is not a reason to add a second
lint runner, a second configuration file, or Effect platform services to the
plugin.

## Source and release record

The tagged release is version `0.3.3`. Its package manifest declares:

- `effect` as a peer dependency at `^4.0.0-beta.100`.
- `effect` and `@effect/vitest` at `4.0.0-beta.100` for development.
- `@oxlint/plugins` as a runtime dependency at `^1.66.0`.
- ESM `dist` entrypoints for the npm package and a separate
  `effect-oxlint/testing` entrypoint.

See the [tagged package manifest](https://raw.githubusercontent.com/mpsuesser/effect-oxlint/37ea33bf5684c00cf4d6d26a8826329dc6fee1e9/package.json)
and the [release history](https://github.com/mpsuesser/effect-oxlint/blob/v0.3.3/CHANGELOG.md).

The repository has a small, focused source tree. The main modules are
`Rule`, `Visitor`, `RuleContext`, `AST`, `Diagnostic`, `SourceCode`, `Scope`,
`Plugin`, and `Testing`. The release has 260 tests across 11 test files.

I ran these checks in an isolated clone of the tagged source:

```text
bun run check       pass
bun run test        260 tests pass
bun run typecheck   pass
bun run build       pass
```

I then checked the source against this repository's versions:

```text
effect                 4.0.0-beta.107
@oxlint/plugins        1.73.0
effect-oxlint source   v0.3.3
```

The same check, test, typecheck, and build commands passed after changing the
isolated copy to Effect beta.107 and `@oxlint/plugins` 1.73. A runtime smoke
test also loaded the built package and its `testing` subpath with those
versions. This proves source-level compatibility for this cohort. It does not
remove the need for the real `vp lint` integration test because Oxlint's JS
plugin API is still alpha.

## Oxlint boundary

Oxlint supports both the standard ESLint-compatible `create` API and its
alternative `createOnce` API. The official documentation says that JavaScript
plugins are alpha, and that `createOnce` is designed for future performance
optimisations. `createOnce` is called once for the plugin rule; per-file setup
belongs in `before`, and cleanup belongs in `after`.

- [Oxlint JS plugin overview](https://oxc.rs/docs/guide/usage/linter/js-plugins.html)
- [Oxlint JS plugin authoring](https://oxc.rs/docs/guide/usage/linter/writing-js-plugins.html)
- [`@oxlint/plugins` source package](https://github.com/oxc-project/oxc/tree/main/npm/oxlint-plugins)

The official authoring guide also says that a published plugin must list
`@oxlint/plugins` as a runtime dependency. `effect-oxlint` follows that rule.

The MZE configuration uses the package boundary:

```ts
lint: {
  jsPlugins: ["@mze-store/oxlint"],
  rules: {
    "hadronomy/prefer-tilde-imports": "error",
  },
}
```

Keep this Vite+ configuration after the package build. `Plugin.define`'s generated `configs` are for
shareable `oxlint.config.ts` presets. They are not needed for this local
Vite+ plugin.

## What the package provides

### `Rule.define`

`Rule.define` accepts a generator which returns a typed visitor map. The
generator runs once for each file. Each returned handler is wrapped with
`Effect.runSync` when Oxlint invokes it. The package makes the synchronous
boundary explicit in its source and documentation.

The handler type is:

```ts
Effect.Effect<void, never, RuleContext>;
```

The `never` error channel is important. Oxlint has no typed failure channel.
An Effect failure must be caught inside the handler and converted to a
diagnostic or ignored. A defect or an asynchronous effect can escape into the
linter process. Do not put network calls, child processes, or other async
work in a rule handler.

The package decodes only `context.options[0]` when a Schema is supplied. An
invalid option raises through synchronous Schema decoding. Treat rule options
as a configuration boundary and keep the schema small.

Primary source: [`src/Rule.ts`](https://github.com/mpsuesser/effect-oxlint/blob/v0.3.3/src/Rule.ts).

### `RuleContext`

`RuleContext` is a good Effect v4 service boundary. It exposes:

- `report` as an Effect action.
- `id`, `filename`, and `cwd`.
- Raw rule `options`.
- `sourceCode`, `languageOptions`, and `settings`.

The service does not expose `physicalFilename`, `getFilename`, or
`getPhysicalFilename`. The current MZE rule deliberately reads
`context.physicalFilename` because virtual paths and physical paths can differ.
An adapter must expose that value before a migration.

Primary source: [`src/RuleContext.ts`](https://github.com/mpsuesser/effect-oxlint/blob/v0.3.3/src/RuleContext.ts).

### `Visitor`

The visitor module provides:

- `on` and `onExit` constructors.
- `merge` for sequential handlers on one node type.
- `tracked` for a `Ref<number>` enter/exit counter.
- `filter` for a file-name predicate evaluated during rule creation.
- `accumulate` for collecting values and analysing them at `Program:exit`.

These helpers are useful for Effect-centric rules. They do not replace the
Oxlint traversal contract. `accumulate` appends to an immutable array for each
matching node, so it is not a good default for very large collections.

Primary source: [`src/Visitor.ts`](https://github.com/mpsuesser/effect-oxlint/blob/v0.3.3/src/Visitor.ts).

### `AST`, `Diagnostic`, and `SourceCode`

`AST` provides safe common matchers such as `narrow`, `matchMember`,
`matchCallOf`, `matchImport`, `memberPath`, and ancestor helpers. Matchers
return `Option`, which fits Effect pipelines and avoids unchecked casts.

`Diagnostic` provides constructors and fix combinators. It keeps the Oxlint
diagnostic shape and does not add a second output model.

`SourceCode` and `Scope` wrap common Oxlint queries as effects. Nullable
results become `Option`; arrays stay arrays. The wrappers cover the queries
needed by many rules, but they are not a complete replacement for every
upstream `SourceCode` method.

Primary sources:

- [`src/AST.ts`](https://github.com/mpsuesser/effect-oxlint/blob/v0.3.3/src/AST.ts)
- [`src/Diagnostic.ts`](https://github.com/mpsuesser/effect-oxlint/blob/v0.3.3/src/Diagnostic.ts)
- [`src/SourceCode.ts`](https://github.com/mpsuesser/effect-oxlint/blob/v0.3.3/src/SourceCode.ts)
- [`src/Scope.ts`](https://github.com/mpsuesser/effect-oxlint/blob/v0.3.3/src/Scope.ts)

## Effect v4 design fit

The package uses the right Effect boundary for a synchronous host:

- `Context.Service` carries the Oxlint context into the rule generator and
  handlers.
- `Effect.gen` composes setup and visitor work.
- `Option` represents absent AST and source-code values.
- `Schema` validates rule options at the host boundary.
- `Effect.runSync` appears only at the Oxlint callback boundary.

Keep this shape if MZE adopts the package. Do not add a platform `Layer` or a
long-lived fiber to an AST visitor. There is no resource lifecycle for those
services in Oxlint's synchronous callback contract. Keep the handler error
channel `never`, and turn expected analysis failures into diagnostics at the
rule boundary.

### `Plugin.define`

`Plugin.define` returns a normal Oxlint plugin and adds `configs.recommended`
and `configs.all`. It can type-check a curated recommended rule list and can
emit a package specifier plus fully qualified rule IDs.

This is useful for a published plugin. It is not a reason to change MZE's
local Vite+ configuration. The local plugin path and the `hadronomy` rule
namespace remain the source of truth.

Primary source: [`src/Plugin.ts`](https://github.com/mpsuesser/effect-oxlint/blob/v0.3.3/src/Plugin.ts).

### `Testing`

`effect-oxlint/testing` supplies mock contexts, AST builders, rule runners,
and diagnostic assertions. It is a good unit-test layer for small rule
patterns. It uses mock AST objects, so it cannot replace MZE's existing
end-to-end `vp lint --fix` test. Keep both levels:

1. `effect-oxlint/testing` for handler and matcher behavior.
2. `vp lint --fix` against a temporary project for the real Oxlint bridge.

Primary source: [`src/Testing.ts`](https://github.com/mpsuesser/effect-oxlint/blob/v0.3.3/src/Testing.ts).

## Fit with the current MZE rule

The current rule has a different shape from the package examples:

| Concern          | Current MZE rule                                           | `effect-oxlint` default                             |
| ---------------- | ---------------------------------------------------------- | --------------------------------------------------- |
| Oxlint lifecycle | `createOnce` with `eslintCompatPlugin`                     | `create` from `Rule.define`                         |
| Per-node work    | Synchronous TypeScript and filesystem resolution           | `Effect.runSync` per handler call                   |
| Context path     | Uses `physicalFilename`                                    | Exposes `filename` only                             |
| State            | Module cache for parsed `tsconfig` data                    | `Ref` state in a per-file `create` closure          |
| AST work         | Custom import, export, import-type, and `require` handling | Common `Option` matchers and visitors               |
| Test boundary    | Real `vp lint --fix` and idempotence                       | Mock rule runners plus user-owned integration tests |
| Config           | Vite+ `lint.jsPlugins` local path                          | Optional generated `oxlint.config.ts` presets       |

The path resolver is a good pure module. Keep its filesystem and TypeScript
resolution code synchronous and test it directly. Wrapping those calls in
Effects does not make them safer because the Oxlint callback is synchronous.

The package can improve the rule's AST matching and diagnostic construction,
but a direct `Rule.define` migration changes the lifecycle and can add a cost
to every import and call visitor. It can also change behavior for virtual
filenames. Those are correctness and performance risks, not style details.

## Adoption plan

Use this sequence if the plugin moves to Effect:

1. Add `effect-oxlint@0.3.3` as an exact runtime dependency of the private
   `tooling/oxlint` package. Keep the package's exact
   `effect@4.0.0-beta.107` and `@oxlint/plugins@1.73.0`
   pins. Do not use a caret for the new package while Effect v4 and Oxlint JS
   plugins are beta and alpha APIs.
2. Add a small local adapter for `RuleContext` that preserves
   `physicalFilename`. Keep all filesystem and TypeScript module resolution
   helpers pure.
3. Port one diagnostic path with the package's pure `AST` and `Diagnostic`
   helpers while the rule still uses its existing `createOnce` wrapper. Do
   not use `Rule.define` for that pilot. Stop and upstream a `Rule.defineOnce`
   API before moving Effect handlers into the default lint path.
4. Add `effect-oxlint/testing` unit tests for the ported path. Keep the current
   full `vp lint --fix` test and add a virtual-versus-physical filename case.
5. Benchmark `vp lint --fix` on the repository and on a generated project with
   many imports. Accept the migration only if diagnostic output and fixes are
   identical and the runtime cost is measured and acceptable.
6. If the benchmark fails, keep the current `createOnce` rule and use a local
   Effect adapter or an upstream `createOnce` extension. Do not force the
   slower `create` bridge into the default lint path.

Do not add `@effect/platform-node`, terminal services, child processes, or
asynchronous fibers to the Oxlint plugin. Those services belong to
`tooling/mze` workflows, not AST visitors.

## Decision

Adopt the package as a constrained pilot and as a source of Effect v4 rule
design patterns. Do not perform a direct full migration of
`tooling/oxlint/src/index.ts` in the current tooling package. The next implementation
change must first add the physical-filename adapter, preserve or measure the
`createOnce` lifecycle, and retain the real Vite+ integration test.

The repository's Effect v4 cohort is pinned to
`4.0.0-beta.107`. Keep that exact cohort. The official Effect package source
and export map are recorded at the [beta.107 tag](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/package.json).
