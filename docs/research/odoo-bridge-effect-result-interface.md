# Odoo bridge Effect Result interface

**Status:** Implemented

**Date:** 2026-08-21

This record defines the public interface for issue #132. The bridge has one
native Effect core and one Result client for Medusa. Both surfaces use the same
service, contracts, and tagged failures.

## Source basis

The implementation uses the repository's pinned `effect@4.0.0-rc.109` source:

- [`Result`](../../node_modules/effect/src/Result.ts) supplies the typed success
  and failure value used at the Promise boundary.
- [`Effect.result`](../../node_modules/effect/src/Effect.ts) moves typed Effect
  failures into `Result`. It does not hide defects or interruption.
- [`ManagedRuntime`](../../node_modules/effect/src/ManagedRuntime.ts) builds one
  service layer, reuses it across calls, and closes its scope.
- [`Context.Service`](../../node_modules/effect/src/Context.ts) supplies the
  native service shape.
- [`Schema.TaggedError`](../../node_modules/effect/src/Schema.ts) supplies
  schema-backed, yieldable failures with literal `_tag` fields.
- [`HttpClient`](../../node_modules/effect/src/unstable/http/HttpClient.ts)
  supplies request transforms, interruption, and typed transport behavior.

Effect's [`Optic`](../../node_modules/effect/src/Optic.ts) focuses and updates
parts of existing values. Client creation constructs and validates a new
settings value. An optic would add another abstraction without removing a
rule. The implementation uses one object literal with an optional timeout and
one `Result` decoder.

Better Result was also reviewed. It solves the same boundary problem as
Effect's `Result`. Adding it would create two Result vocabularies and another
dependency. The bridge exports Effect's `Result` from its root instead.

## Package entries

```text
@mze-store/odoo-bridge           Result client and plain contract types
@mze-store/odoo-bridge/effect    Native Effect service and exact errors
@mze-store/odoo-bridge/contract  Effect Schema codecs and contract types
```

There is no `/promise`, `/result`, raw RPC, or throwing client entry.

## Root client

`createOdooBridge` accepts one options object. It validates all local settings
before it creates a runtime or sends a request.

```ts
interface Options {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly database: string;
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly requestTimeoutMs?: number | undefined;
}

declare function createOdooBridge(
  options: Options,
): Result.Result<OdooBridgeClient, ConfigurationError>;
```

`fetch` defaults to `globalThis.fetch`. Tests, workers, and hosts with a custom
transport can supply it without a second factory.

The client has this complete asynchronous interface:

```ts
interface OdooBridgeClient extends AsyncDisposable {
  readonly checkContract: (
    options?: CallOptions,
  ) => Promise<Result.Result<BridgeContractCheck, CheckContractError | CallError>>;

  readonly readCatalogBatch: (
    options?: ReadCatalogBatchOptions,
  ) => Promise<Result.Result<CatalogBatch, ReadCatalogBatchError | CallError>>;

  readonly close: () => Promise<void>;
}
```

`ReadCatalogBatchOptions` combines `cursor`, `limit`, and `signal`. A caller
does not pass an `undefined` domain argument to reach call options.

```ts
const batch = await bridge.readCatalogBatch({
  cursor: previousRevision,
  limit: 100,
  signal: request.signal,
});
```

The managed runtime scope owns active fibers. `close()` closes that scope,
interrupts active calls, and is idempotent. A tagged `Open | Closing | Closed`
state records the lifecycle. The client does not keep a second active-call set.

## Failure policy

Each failure is a direct `Schema.TaggedError`. There is no generic wrapper,
nested reason, operation string, error factory, or duplicate code property.
Consumers narrow on `error._tag` and read fields such as `status` or `part`
directly.

The core operation unions are exact:

- `readCatalogBatch`: invalid input, HTTP request failures, and an invalid
  Catalog Batch response.
- `checkContract`: HTTP request failures, three distinct response failures,
  missing contract parts, invalid method markers, and an empty fixture.
- `createOdooBridge`: API key, database, timeout, and Private Odoo Route
  failures.

The Result adapter adds `OdooBridgeCallAborted` and
`OdooBridgeClientClosed` to operation failures. Native Effect consumers use
Effect interruption and scope instead.

Expected outcomes fulfill the Promise with `Success` or `Failure`. Unknown
defects reject it. The adapter uses `Effect.result` for typed failures. It keeps
`Exit` and `Cause` private so it can classify an external runtime interrupt
without turning a defect into an expected bridge failure.

## Result client example

```ts
import { Result, createOdooBridge } from "@mze-store/odoo-bridge";

const created = createOdooBridge({
  apiKey: ENV.ODOO_API_KEY,
  baseUrl: ENV.ODOO_BASE_URL,
  database: ENV.ODOO_DATABASE,
});

if (Result.isFailure(created)) {
  report(created.failure);
  return;
}

await using bridge = created.success;
const read = await bridge.readCatalogBatch({ limit: 100 });

if (Result.isFailure(read)) {
  switch (read.failure._tag) {
    case "AuthenticationFailed":
    case "PermissionDenied":
      reportCredentialFailure(read.failure);
      return;
    case "OdooBridgeCallAborted":
      return;
    default:
      report(read.failure);
      return;
  }
}

await importCatalogBatch(read.success.items);
```

## Native Effect example

```ts
import { Effect, Layer, Redacted } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { OdooBridge } from "@mze-store/odoo-bridge/effect";

const program = OdooBridge.readCatalogBatch({ limit: 100 }).pipe(
  Effect.catchTag("AuthenticationFailed", (error) =>
    Effect.logError(error.message).pipe(Effect.andThen(Effect.fail(error))),
  ),
);

const OdooBridgeLive = OdooBridge.layer({
  apiKey: Redacted.make(ENV.ODOO_API_KEY),
  baseUrl: ENV.ODOO_BASE_URL,
  database: ENV.ODOO_DATABASE,
}).pipe(Layer.provide(FetchHttpClient.layer));

const batch = await Effect.runPromise(program.pipe(Effect.provide(OdooBridgeLive)));
```

The native error channel remains visible to `Effect.catchTag`, retries,
schedules, tracing, layers, tests, and all other Effect operators.

## Decisions

1. Remove `makeOdooBridgeError`.
2. Remove the generic `OdooBridgeError` wrapper and nested reason union.
3. Use direct `Schema.TaggedError` classes.
4. Give each operation its exact error union.
5. Keep the core as `Effect<A, E, R>`.
6. Use `Effect.result` at the Result boundary.
7. Return Effect `Result` values from the non-Effect API.
8. Map caller abort and client close to explicit boundary failures.
9. Keep defects as rejected promises.
10. Keep `Exit` and `Cause` private.
