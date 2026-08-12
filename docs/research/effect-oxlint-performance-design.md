# `effect-oxlint` performance API design

**Date:** 2026-08-12

**Upstream package:** [`mpsuesser/effect-oxlint`](https://github.com/mpsuesser/effect-oxlint)

**Reviewed release:** [`v0.3.3`](https://github.com/mpsuesser/effect-oxlint/tree/v0.3.3)

**Scope:** Design an Effect-centric API that keeps Oxlint visitor work fast.

## Decision summary

Use Effect for rule setup, static services, option schemas, diagnostics, and
tests. Compile the AST hot path into synchronous Oxlint callbacks.

Add an additive `Rule.defineOnce` API. Keep the existing `Rule.define` API for
compatibility. Add explicit synchronous and effectful visitor constructors:

```ts
Visitor.onSync(...)
Visitor.onEffect(...)
```

`onSync` must not create an Effect or call an Effect runtime for each node.
`onEffect` remains an escape hatch for handlers that need Effect services.

The package must split static rule setup from the per-file `FileContext`. The
file context must expose `physicalFilename` through a dynamic view of the
Oxlint context.

## Requirements

The API must satisfy these requirements:

1. Use Oxlint's `createOnce` lifecycle.
2. Preserve `physicalFilename`, source code, options, and reporting.
3. Run static setup once per rule instance.
4. Keep synchronous rules free of per-node Effect interpretation.
5. Keep Effect services available to advanced handlers.
6. Keep the host error channel truthful. Oxlint callbacks are synchronous.
7. Keep the existing `Rule.define` API working.
8. Keep ESLint compatibility through `eslintCompatPlugin`.
9. Expose visitor keys early enough for Oxlint's future traversal optimizations.
10. Keep the resolver and other synchronous analysis functions pure.

## Findings from the current package

The current package has a useful Effect authoring surface. It provides
`Rule`, `Visitor`, `AST`, `Diagnostic`, `SourceCode`, `Scope`, `Plugin`, and
`Testing` modules.

The main performance boundary is in
[`Rule.ts`](https://github.com/mpsuesser/effect-oxlint/blob/v0.3.3/src/Rule.ts#L1790-L1844):

- `Rule.define` returns the standard per-file `create` API.
- The rule setup generator runs once for each file.
- Each visitor handler runs through `Effect.runSync`.
- Each handler run provides `RuleContext` again.

[`Visitor.toOxlintVisitor`](https://github.com/mpsuesser/effect-oxlint/blob/v0.3.3/src/Visitor.ts#L1364-L1378)
maps every Effect handler to a plain Oxlint callback. It does not compile the
Effect visitor graph into direct callbacks.

Other hot-path costs exist:

- `Visitor.merge` builds nested `Effect.andThen` chains.
- `Visitor.tracked` uses `Ref` operations for every enter and exit event.
- `Visitor.accumulate` copies an immutable array on every match.
- `SourceCode` wraps synchronous queries in Effects.

The package also lacks `physicalFilename` in its `RuleContext` service. The
current MZE rule needs that field for module resolution. See the existing
[package audit](./effect-oxlint-plugin.md).

Oxlint documents JavaScript plugins as alpha. It documents `createOnce` as the
performance-oriented API and describes `before` and `after` as file lifecycle
hooks. [JS plugin overview](https://oxc.rs/docs/guide/usage/linter/js-plugins),
[plugin authoring guide](https://oxc.rs/docs/guide/usage/linter/writing-js-plugins)

Oxlint also restricts file context during `createOnce` setup. The v1.40 release
blocked `cwd` access during `createOnce`. [Oxlint v1.40 release](https://github.com/oxc-project/oxc/releases/tag/apps_v1.40.0)

The package must therefore avoid a file-context snapshot during global setup.

## Design A: pre-bound Effect runtime

This design keeps all handlers as Effects. It reduces the bridge cost without
changing the visitor authoring model.

### Interface

```ts
interface OnceRuleConfig<Services> {
  readonly name: string
  readonly meta: RuleMeta
  readonly setup: Effect.Effect<EffectVisitor, never, Services>
  readonly runtime: RuleRuntime<Services>
}

const Rule = {
  defineOnce<Services>(config: OnceRuleConfig<Services>): CreateOnceRule
}
```

`FileContext` is a dynamic Effect service. Its fields read the current Oxlint
context when a handler uses them.

### Usage

```ts
const rule = Rule.defineOnce({
  name: "prefer-tilde-imports",
  meta,

  setup: Effect.fn("prefer-tilde-imports.setup")(function* () {
    const resolver = yield* Resolver;

    return Visitor.on("ImportDeclaration", (node) =>
      Effect.gen(function* () {
        const file = yield* FileContext;
        const replacement = resolver.preferred(file.physicalFilename, node.source.value);

        if (replacement !== undefined) {
          yield* file.report(
            Diagnostic.make({
              node: node.source,
              message: `Use ${replacement}`,
            }),
          );
        }
      }),
    );
  }),

  runtime: RuleRuntime.layer(Resolver.layer),
});
```

### Hidden implementation

1. Run setup once.
2. Build one synchronous runtime.
3. Provide one dynamic `FileContext` proxy.
4. Return a real `createOnce` visitor.
5. Run each handler with the pre-built runtime.

The proxy must look up `context.report` at call time. It must not capture the
placeholder that Oxlint exposes during `createOnce` construction.

### Trade-offs

This design is easy to add and keeps the current API shape. It supports Ref,
SourceCode, Scope, and custom services in handlers.

Each AST event still enters the Effect runtime. It improves runtime setup but
does not remove interpreter cost. It also gives Oxlint less static information
about the work performed by a rule.

Use this design as a compatibility step if a direct fast path is not ready.

## Design B: split synchronous and effectful visitors

This design makes the hot-path cost visible in the API. It uses Effect for
setup and direct functions for common AST events.

### Interface

```ts
interface FileContext {
  readonly id: string
  readonly filename: string
  readonly physicalFilename: string
  readonly cwd: string
  readonly sourceCode: SourceCode
  readonly options: ReadonlyArray<unknown>
  readonly report: (diagnostic: Diagnostic) => void
}

interface VisitorSpec<Services = never> {
  readonly _tag: "VisitorSpec"
}

const Visitor = {
  onSync<Node>(
    key: VisitorKey,
    handler: (node: Node, file: FileContext) => void,
  ): VisitorSpec,

  onEffect<Node, Services>(
    key: VisitorKey,
    handler: (
      node: Node,
    ) => Effect.Effect<void, never, Services | FileContext>,
  ): VisitorSpec,

  onExitSync<Node>(
    key: VisitorKey,
    handler: (node: Node, file: FileContext) => void,
  ): VisitorSpec,

  merge(...visitors: ReadonlyArray<VisitorSpec>): VisitorSpec,
}

interface OnceRuleConfig<Services> {
  readonly name: string
  readonly meta: RuleMeta
  readonly setup: Effect.Effect<VisitorSpec<Services>, never, Services>
}

const Rule = {
  defineOnce<Services>(config: OnceRuleConfig<Services>): CreateOnceRule
}
```

### Usage

```ts
const rule = Rule.defineOnce({
  name: "prefer-tilde-imports",
  meta,

  setup: Effect.fn("prefer-tilde-imports.setup")(function* () {
    const resolver = yield* Resolver;

    return Visitor.merge(
      Visitor.onSync("ImportDeclaration", (node, file) => {
        const replacement = resolver.preferred(file.physicalFilename, node.source.value);

        if (replacement !== undefined) {
          file.report(
            Diagnostic.make({
              node: node.source,
              message: `Use ${replacement}`,
            }),
          );
        }
      }),

      Visitor.onSync("ExportAllDeclaration", (node, file) => {
        // Use the same direct path for export sources.
      }),
    );
  }),
});
```

### Hidden implementation

1. Run the setup Effect once.
2. Compile every `onSync` visitor into a direct callback.
3. Flatten handlers merged under the same visitor key.
4. Build one runtime for `onEffect` visitors.
5. Provide a dynamic file view for the current file.
6. Return `createOnce` with `before` and `after` hooks when needed.

The direct callback must not construct an Effect, call `Effect.runSync`, or
provide a service. It can use pure AST matchers and diagnostic builders.

The effectful path can use `FileContext` as a service. The package must provide
that service through a stable proxy, not through a new context object for every
node.

### Trade-offs

This design gives the common case a direct path and keeps advanced Effect code.
The API adds one choice for rule authors. The names make the runtime cost clear.

`onSync` handlers cannot yield services during an AST event. Capture long-lived
services during setup. Read file-local values from the `FileContext` argument.

This design fits MZE. The resolver is synchronous, and the rule already uses
`createOnce` and `physicalFilename`.

## Design C: declarative rule plan

This design uses a restricted rule intermediate representation. The compiler
can expose static visitor keys and optimize recognized actions.

### Interface

```ts
interface RulePlan<Services = never> {
  readonly name: string
  readonly meta: RuleMeta
  readonly setup: Effect.Effect<StaticState, never, Services>
  readonly visitors: ReadonlyArray<RuleClause>
}

interface RuleClause {
  readonly event: VisitorKey
  readonly match: Matcher
  readonly action: SyncAction | EffectAction
}

const Rule = {
  plan<Services>(config: RulePlan<Services>): RulePlan<Services>
  compile(plan: RulePlan<never>): CreateOnceRule
}
```

### Usage

```ts
const plan = Rule.plan({
  name: "prefer-tilde-imports",
  meta,

  setup: Effect.fn("prefer-tilde-imports.setup")(function* () {
    return { resolver: yield* Resolver };
  }),

  visitors: [
    Rule.match(
      "ImportDeclaration",
      AST.matchImportSource(),
      Rule.action.sync(({ node, file, state }) => {
        const replacement = state.resolver.preferred(file.physicalFilename, node.source.value);

        if (replacement !== undefined) {
          file.report(
            Diagnostic.make({
              node: node.source,
              message: `Use ${replacement}`,
            }),
          );
        }
      }),
    ),
  ],
});

const rule = Rule.compile(plan);
```

### Hidden implementation

The plan compiler can:

- flatten visitor clauses;
- remove duplicate matcher work;
- use direct counters for tracking;
- use mutable internal buffers for accumulation;
- emit the exact interested visitor keys;
- route advanced actions through the Effect runtime.

The compiler must provide an explicit slow action for arbitrary Effects:

```ts
Rule.action.effect((node) =>
  Effect.gen(function* () {
    // Advanced handler.
  }),
);
```

An opaque arbitrary Effect cannot be compiled into a zero-cost callback. The
plan API therefore has stronger limits than `Rule.defineOnce`.

### Trade-offs

This design has the highest performance ceiling and aligns with Oxlint's future
static traversal optimizations. It also creates a second rule language. Users
cannot express every Effect program in the plan IR.

Use this design after the split visitor API has proven its value.

## Comparison

Design A has the smallest migration. It preserves the current Effect visitor
model and removes repeated runtime construction. Its per-node interpreter cost
remains.

Design B gives the best balance. It keeps Effect for setup and advanced work,
while common handlers use direct callbacks. Its cost model is visible and its
types fit the synchronous Oxlint host.

Design C gives the compiler the most information. It can support future
Rust-side traversal improvements, but its restricted language needs more design
and documentation.

## Recommended synthesis

Use Design B as the public API. Use Design A's pre-built runtime for the
`onEffect` escape hatch. Build Design C's plan compiler behind the same
`VisitorSpec` boundary later.

The public surface becomes:

```ts
Rule.define(...)        // existing per-file Effect API
Rule.defineOnce(...)    // new createOnce API
Visitor.onSync(...)     // direct synchronous path
Visitor.onEffect(...)   // explicit Effect path
FileContext             // dynamic file view, including physicalFilename
```

The package must keep `Rule.define` unchanged. This avoids a silent performance
or lifecycle change for existing consumers.

The package must split two kinds of context:

- setup context for static services and rule construction;
- file context for filename, source code, options, and reporting.

The file context is valid only during a file callback. The package must not
allow asynchronous work to retain it after the callback returns.

All host-facing Effects must use an error channel of `never`. Expected analysis
failures must become diagnostics inside the handler. Network calls, child
processes, platform services, and fibers do not belong in AST visitors.

## Evolution path

### Release 0.4: lifecycle and fast path

1. Add `FileContext` with `physicalFilename`.
2. Add `Rule.defineOnce`.
3. Add `Visitor.onSync` and `Visitor.onEffect`.
4. Compile `onSync` visitors into direct callbacks.
5. Pre-build one runtime for `onEffect` visitors.
6. Flatten `Visitor.merge` during compilation.
7. Add createOnce context restriction tests.
8. Add ESLint compatibility tests through `eslintCompatPlugin`.

### Release 0.5: state and source query costs

1. Add direct internal state for `tracked`.
2. Add amortized buffers for `accumulate`.
3. Separate pure `SourceCode` helpers from Effect wrappers.
4. Preserve the Effect wrappers for advanced handlers.
5. Add per-rule visitor-key metadata.

### Release 0.6: plan compiler

1. Add `Rule.plan` and `Rule.compile`.
2. Add match and action constructors.
3. Emit static interested visitor keys.
4. Add a slow action for arbitrary Effects.
5. Benchmark plan rules against `onSync` rules.

### Release 1.0: stable contract

Make the lifecycle contract stable only after Oxlint's plugin API has a stable
version. Keep exact compatibility tests for the supported Oxlint versions.

## Acceptance gates

The implementation must pass these gates before MZE adopts it:

1. `vp lint --fix` produces the same diagnostics and fixes as the current rule.
2. The MZE rule preserves `physicalFilename` for virtual and physical files.
3. The fast path performs no per-node `Effect.runSync` call.
4. A large import fixture shows a measured improvement over `Rule.define`.
5. `before` returning `false` skips a file correctly.
6. `after` runs after traversal and clears file-local state.
7. A failing child or async Effect cannot enter the visitor API.
8. ESLint compatibility remains explicit and tested.
9. Real `vp lint --fix` tests remain beside package-level mock tests.
10. No second linter, task runner, or configuration file is added.

## Open questions

Before implementation, upstream must answer these questions with integration
tests:

- Is rule option data available during `createOnce` setup?
- Which context properties are legal during `createOnce` construction?
- Can a plugin instance receive concurrent file callbacks?
- When does Oxlint guarantee `before` and `after` execution?
- Which visitor keys can Oxlint skip today?
- Which runtime cost matters after the direct path removes Effect overhead?

These answers define the safe shape of `Rule.defineOnce`.
