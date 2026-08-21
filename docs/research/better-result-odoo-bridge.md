# `better-result` and the Odoo Bridge Promise interface

Research date: 2026-08-20

Repository inspected: `dmmulroy/better-result` at commit [`c6d02fa`](https://github.com/dmmulroy/better-result/commit/c6d02fadde5e2e160caea99eecb09b37d810e31a).

This note records the library's current contract and its fit for the non-Effect side of `@mze-store/odoo-bridge`. It does not select the final Bridge interface.

## Executive finding

`better-result` can improve the non-Effect API's error handling when callers need to compose several Bridge calls or make an explicit policy decision. Its core type is:

```ts
Result<Success, ExpectedError>;
```

An asynchronous operation is represented as:

```ts
Promise<Result<Success, ExpectedError>>;
```

The package does not expose a `ResultAsync` class. It uses ordinary Promises plus static and instance Result combinators. The official source uses `Result.tryPromise`, `Result.await`, and async variants such as `Result.andThenAsync` and `Result.tryRecoverAsync` for this model. See [`src/result.ts`](https://raw.githubusercontent.com/dmmulroy/better-result/c6d02fadde5e2e160caea99eecb09b37d810e31a/src/result.ts).

The library is a good fit for an explicit opt-in Result entry point. It is a poor fit as an invisible replacement for the existing Promise contract because it adds a required branch decision at every call site, introduces a new runtime dependency, and is ESM-only. The current Bridge already gives callers a typed `OdooBridgeError`; Result adds a typed value channel for handling that error without `try/catch`.

## Current package contract

The published package is currently version `3.0.1`. Its package manifest requires TypeScript 5.4 or newer and declares `type: module`. Its only runtime export is the ESM `dist/index.mjs`; it has no CommonJS condition. It declares zero runtime dependencies and is marked side-effect free. See the [package manifest at the inspected commit](https://raw.githubusercontent.com/dmmulroy/better-result/c6d02fadde5e2e160caea99eecb09b37d810e31a/package.json).

The v3 release is recent and introduced breaking changes from 2.x. The release notes record the removal of the old serialization helpers, the new `Result.codec` boundary, the changed `TaggedError` syntax, the reserved `match` member, and widened inferred unions. See the [v3.0.0 release notes](https://github.com/dmmulroy/better-result/releases/tag/v3.0.0).

The repository has active open type-inference issues. For example, issue [#111](https://github.com/dmmulroy/better-result/issues/111) reports that `match` currently requires both branches to return a compatible shape in a Hono handler. Issue [#110](https://github.com/dmmulroy/better-result/issues/110) reports that the pipeable `matchErrorPartial` fallback widens its unhandled error parameter. Issue [#107](https://github.com/dmmulroy/better-result/issues/107) reports unwanted inference from a `tap` callback. These issues do not make the core Result unsafe, but they matter for a public library that promises low-friction inference.

## Public API

### Construction and narrowing

The runtime and type are imported from one `Result` namespace:

```ts
import { Result, TaggedError, type Result as ResultType } from "better-result";
```

The main constructors and guards are:

```ts
Result.ok(value?)
Result.err(error)
Result.isOk(result)
Result.isError(result)
```

The value is a discriminated union with `status` equal to `"ok"` or `"error"`. Both classes also expose instance guards and values:

```ts
if (result.status === "ok") {
  result.value;
} else {
  result.error;
}
```

`Ok<A, E>` and `Err<T, E>` carry the opposite type as a phantom parameter. This symmetric shape lets generator inference collect all yielded error types. The implementation and the type definitions are in [`src/core.ts`](https://raw.githubusercontent.com/dmmulroy/better-result/c6d02fadde5e2e160caea99eecb09b37d810e31a/src/core.ts).

### Typed errors

`TaggedError` creates real `Error` subclasses with a literal `_tag`, readonly payload properties, JSON serialization, a class-level `.is()` guard, and an instance `.match()` method:

```ts
class CatalogUnavailable extends TaggedError("CatalogUnavailable")<{
  message: string;
  status?: number;
}> {}

const error = new CatalogUnavailable({
  message: "Odoo is unavailable",
  status: 503,
});

if (CatalogUnavailable.is(error)) {
  error.status;
}
```

Tagged errors are also yieldable in `Result.gen`. A caller can use an error as a guard clause without wrapping it in `Result.err`.

`Panic` represents a defect. If a callback passed to `map`, `andThen`, `match`, recovery, observation, or codec validation throws, better-result throws `Panic`. It does not add `unknown` to the expected error union. `UnhandledException` is the typed wrapper used by the function overload of `Result.try` and `Result.tryPromise` when no custom error mapper is supplied.

The relevant implementation is [`src/error.ts`](https://raw.githubusercontent.com/dmmulroy/better-result/c6d02fadde5e2e160caea99eecb09b37d810e31a/src/error.ts) and the library's [Panic guidance](https://better-result.dev/errors/panic-and-defects) explains the expected boundary.

### Composition

Synchronous composition uses instance methods or data-first/data-last static functions:

```ts
result.map(selectValue).andThen(validateValue).mapError(normalizeError);
```

The main operations are:

| Operation                    | Runs on         | Result                                   |
| ---------------------------- | --------------- | ---------------------------------------- |
| `map`                        | `Ok`            | Changes the success value.               |
| `mapError`                   | `Err`           | Changes the error value.                 |
| `andThen`                    | `Ok`            | Runs another Result-returning operation. |
| `tryRecover`                 | `Err`           | Recovers with another Result.            |
| `tap`, `tapError`, `tapBoth` | Selected branch | Observes without changing the Result.    |
| `match`                      | Both branches   | Leaves the Result abstraction.           |
| `unwrapOr`                   | Both branches   | Returns a value or a fallback.           |
| `unwrap`                     | Both branches   | Returns the value or throws `Panic`.     |

`andThen` unions the errors from both operations. `tryRecover` can widen the success type when a fallback returns another value.

### Generator-based composition

`Result.gen` supports synchronous and asynchronous generators. In a synchronous workflow:

```ts
const result = Result.gen(function* () {
  const first = yield* readFirst();
  const second = yield* readSecond(first);
  return Result.ok({ first, second });
});
```

The first `Err` stops the generator. The result type includes the union of every yielded error.

For asynchronous calls, `Result.await` adapts `Promise<Result<A, E>>` to the generator protocol:

```ts
const result = await Result.gen(async function* () {
  const batch = yield* Result.await(readCatalogBatch());
  const enriched = yield* Result.await(enrichBatch(batch));
  return Result.ok(enriched);
});
```

`Result.gen` closes a short-circuited generator. Its implementation invokes `return()` so `finally`, `Symbol.dispose`, and `Symbol.asyncDispose` cleanup can run. The implementation is in [`src/result.ts`](https://raw.githubusercontent.com/dmmulroy/better-result/c6d02fadde5e2e160caea99eecb09b37d810e31a/src/result.ts).

### Promise interop

`Result.tryPromise` converts Promise rejection into `Err`:

```ts
const result = await Result.tryPromise({
  try: ({ signal }) => fetch(url, { signal }),
  catch: (cause) => new NetworkError({ cause }),
});
// Promise<Result<Response, NetworkError>>
```

The function form uses `UnhandledException`:

```ts
const result = await Result.tryPromise(() => fetch(url));
// Promise<Result<Response, UnhandledException>>
```

`Result.tryPromise` accepts an optional signal. It forwards that signal to the callback through `TryPromiseContext`, but it cannot cancel an operation by itself. The callback must pass the signal to a cancellation-aware API. The same signal also interrupts pending retry delays.

It supports bounded retries with:

- `times`
- constant, linear, or exponential backoff
- static or dynamic delay functions
- jitter
- typed `shouldRetry(error, context)` predicates

The Bridge currently owns request timeout and does not retry. A consumer can add a caller-owned retry policy around a Result-returning Bridge operation without changing the Bridge Contract.

For short asynchronous pipelines, `Result.andThenAsync` and `Result.tryRecoverAsync` work with `Promise<Result<...>>`:

```ts
const itemCount = await bridgeResult
  .then(Result.andThenAsync(loadVariants))
  .then(Result.map((variants) => variants.length));
```

`Result.allAsync` concurrently awaits a tuple of Results and returns the first input-order error. `Result.partitionAsync` collects all successes and errors while preserving relative order. A rejected input Promise is treated as a `Panic`, because a Result operation itself violated its contract.

The official async guidance is in the [README's asynchronous section](https://github.com/dmmulroy/better-result#compose-asynchronous-workflows) and the [Result API reference](https://better-result.dev/reference/result).

### Matching and extraction

The normal exit is `match`:

```ts
const response = result.match({
  ok: (batch) => toSuccessResponse(batch),
  err: (error) => toFailureResponse(error),
});
```

Tagged errors can be matched exhaustively:

```ts
const response = result.match({
  ok: toSuccessResponse,
  err: (error) =>
    error.match({
      AuthenticationFailed: () => unauthorized(),
      PermissionDenied: () => forbidden(),
      TransportFailed: () => unavailable(),
    }),
});
```

`matchError` supports structural `_tag` unions and data-first/data-last forms. `matchErrorPartial` transforms selected cases and preserves unhandled cases by default.

One current friction point is that `match` has an open issue when the `ok` and `err` callbacks return different object shapes. The [#111 report](https://github.com/dmmulroy/better-result/issues/111) shows the failure. A Bridge adapter should avoid relying on this exact inference until the issue is resolved or the result type is tested against the pinned package version.

### Standard Schema codecs

`Result.codec` validates both branches at a transport or persistence boundary. It accepts Standard Schema-compatible schemas and supports different in-memory and wire types:

```ts
const codec = Result.codec({
  serialize: {
    ok: CatalogBatchToWire,
    err: OdooBridgeErrorToWire,
  },
  deserialize: {
    ok: CatalogBatchFromWire,
    err: OdooBridgeErrorFromWire,
  },
});
```

Safe operations return `ResultSerializationError` or `ResultDeserializationError` when validation fails. `serializeUnsafe` and `deserializeUnsafe` throw `Panic` for a contract that the application treats as an invariant.

This is relevant to a persisted Medusa cursor or a cross-process Result envelope. It is not required for the direct HTTP response because the Bridge's Effect Schema already validates and maps that response before it reaches the Promise boundary.

## Fit for `@mze-store/odoo-bridge`

### What Result improves

The current Promise client has this shape:

```ts
const batch = await bridge.readCatalogBatch(input);
```

Failure handling uses `try/catch` and the full `OdooBridgeError` union. TypeScript does not encode a Promise rejection type. A caller can accidentally omit handling a recoverable Bridge failure.

An opt-in Result surface can make the failure branch visible:

```ts
const batchResult = await bridgeResult.readCatalogBatch(input);

if (batchResult.status === "error") {
  return handleBridgeFailure(batchResult.error);
}

return sync(batchResult.value);
```

This gives the caller:

- a discriminated success/failure value;
- an error union that survives composition;
- exhaustive `_tag` matching for typed policy decisions;
- no exception control flow for expected Odoo failures;
- easy composition with Medusa's own Result-returning workflows;
- explicit separation between expected Bridge failures and defects.

The strongest benefit appears in workflows with several operations:

```ts
const result = await Result.gen(async function* () {
  const batch = yield* Result.await(readCatalogBatchResult(input));
  const records = yield* Result.await(mapCatalogToMedusaResult(batch));
  yield* validateSyncRecord(records);
  return Result.ok(records);
});
```

Each operation adds its error type. The workflow still has one explicit decision point.

### What Result does not improve

Result does not make a single call shorter than `await`. A caller that only wants to fail the Medusa job still needs to unwrap or match the Result.

Result does not provide typed cancellation. `AbortSignal` remains an out-of-band control signal. `Result.tryPromise` only forwards it to the callback. The Bridge must continue to preserve cancellation as a rejected Promise or a non-Result control path, unless the public contract deliberately models cancellation as an expected error.

Result does not replace the Bridge's error taxonomy. The Bridge still needs safe, operation-specific errors with stable tags, status fields, and sanitized messages.

Result does not remove the need for runtime validation. It wraps values and errors after the Bridge's Effect boundary. A caller must still treat untrusted Odoo data as untrusted.

### Dependency and package risks

The Bridge package currently publishes both ESM and CommonJS root exports. `better-result` publishes only ESM. Adding it as a runtime import to the root implementation can make the generated CommonJS path fail in Node environments that cannot synchronously load an ESM dependency. This is the largest integration risk.

Possible mitigations are architectural choices for the final interface:

- keep the default Promise root free of `better-result` and publish a separate ESM Result entry point;
- bundle the dependency into the CommonJS output after verifying the package builder's licensing and tree-shaking behavior;
- publish only ESM for the Result entry point and document that condition;
- implement a small local Result envelope if the package must remain dual-format and dependency-free.

The first option preserves the current root contract and keeps Result opt-in. It still requires testing both package conditions.

Other adoption risks:

- the public library is currently in a fast-moving 3.0 line;
- v3 made breaking changes from 2.x;
- the current repository has open inference issues in `match`, `matchErrorPartial`, and `tap`;
- TypeScript 5.4 is a minimum requirement;
- the ESM-only package affects Medusa's Jest and generated server paths;
- `Result.codec` introduces Standard Schema types and a second boundary abstraction beside Effect Schema;
- `Panic` is thrown for callback defects, so callers must keep a supervision boundary for unexpected failures;
- errors are classes, so package duplication can affect `instanceof` checks. Prefer the package's static `.is()` guards.

## Recommended use boundaries

The following boundaries are safe conclusions from the source and package contract:

1. Keep the existing Promise client as the low-friction default.
2. Add an explicit Result-oriented entry point only if Medusa has a real workflow that benefits from visible error unions.
3. Make that entry point return `Promise<Result<A, E>>`; do not invent a second async container called `ResultAsync`.
4. Preserve the Bridge's typed errors as the `E` channel. Use `mapError` only when an application workflow intentionally maps them to a broader policy error.
5. Keep abort and client-close behavior outside the expected Result union unless the application has a defined policy for those control events.
6. Do not use `Result.tryPromise` inside the Bridge to replace Effect error handling. The Effect core already owns HTTP, timeout, interruption, response validation, and resource lifecycle.
7. Use `Result.gen` and `Result.await` in Medusa application workflows. Use `Result.andThenAsync` for short pipelines.
8. Use `Result.match` or status narrowing at the Medusa boundary. Avoid `unwrap()` for an Odoo failure that the caller can handle.
9. Pin the package version and add type tests for the exact error unions and match return shapes before exposing the entry point.
10. Do not use `Result.codec` for the Bridge HTTP response. Consider it only for a Result envelope that crosses persistence, RPC, or another independently versioned boundary.

## Sources

- [`README.md` at the inspected commit](https://raw.githubusercontent.com/dmmulroy/better-result/c6d02fadde5e2e160caea99eecb09b37d810e31a/README.md)
- [`src/result.ts`](https://raw.githubusercontent.com/dmmulroy/better-result/c6d02fadde5e2e160caea99eecb09b37d810e31a/src/result.ts)
- [`src/core.ts`](https://raw.githubusercontent.com/dmmulroy/better-result/c6d02fadde5e2e160caea99eecb09b37d810e31a/src/core.ts)
- [`src/error.ts`](https://raw.githubusercontent.com/dmmulroy/better-result/c6d02fadde5e2e160caea99eecb09b37d810e31a/src/error.ts)
- [`package.json`](https://raw.githubusercontent.com/dmmulroy/better-result/c6d02fadde5e2e160caea99eecb09b37d810e31a/package.json)
- [`v3.0.0` release notes](https://github.com/dmmulroy/better-result/releases/tag/v3.0.0)
- [`Result API reference`](https://better-result.dev/reference/result)
- [`Async operations and retries`](https://better-result.dev/core/async-and-retries)
- [`Result codecs`](https://better-result.dev/serialization/result-codecs)
- [`Issue #111: `match` return inference](https://github.com/dmmulroy/better-result/issues/111)
- [`Issue #110: `matchErrorPartial` inference](https://github.com/dmmulroy/better-result/issues/110)
- [`Issue #107: `tap` inference](https://github.com/dmmulroy/better-result/issues/107)
