# Odoo bridge Result interface design

**Status:** Superseded on 2026-08-21

The final interface uses Effect's `Result` and schema-backed tagged errors. It
does not add Better Result. See
[`odoo-bridge-effect-result-interface.md`](./odoo-bridge-effect-result-interface.md).

**Date:** 2026-08-20

This design replaces the non-Effect Promise interface with a Result-first
interface. The native Effect interface stays under `/effect`.

The supporting source review is in
[`better-result-odoo-bridge.md`](./better-result-odoo-bridge.md). The current
interface review is in
[`odoo-bridge-async-api-friction.md`](./odoo-bridge-async-api-friction.md).

## Requirements

The interface must:

- expose only the reviewed Bridge Contract;
- keep expected failures in a typed channel;
- keep defects separate from expected failures;
- support Medusa without Effect knowledge;
- support one-call scripts and multi-step workflows;
- preserve caller cancellation and managed cleanup;
- publish plain contract types at the root;
- publish both ESM and CommonJS builds;
- avoid duplicate throwing and Result method sets.

The interface does not include generic Odoo RPC, retries, pagination loops,
cursor storage, reconciliation, or Sync Record storage.

## Better Result facts

`better-result@3.0.1` uses `Result<A, E>` for synchronous operations. It uses
`Promise<Result<A, E>>` for asynchronous operations. It does not provide a
`ResultAsync` container.

`Result.gen` collects yielded error types into a union. `Result.await` makes a
`Promise<Result<A, E>>` yieldable in an asynchronous generator. The generator
closes after the first `Err`, so `Symbol.asyncDispose` cleanup runs.

`TaggedError` provides literal tags, typed properties, JSON output, matching,
and normal `Error` behavior. `Panic` represents a defect in Result composition.

The package is ESM-only. The bridge must bundle it into the CommonJS output.
The build must prove that no generated CommonJS file calls
`require("better-result")`.

The library has open inference defects in some convenience combinators. The
bridge documentation uses `status` narrowing as the basic form. Type tests
will cover every combinator shown in bridge examples.

## Designs considered

### Design 1: Result-first factory and client

The factory returns `Result<Client, ConfigurationError>`. Remote operations
return `Promise<Result<A, E>>`.

```ts
const created = createOdooBridge(options);

if (created.status === "error") {
  report(created.error);
  return;
}

await using bridge = created.value;
const batch = await bridge.readCatalogBatch({ limit: 100 });
```

This design gives each expected failure one typed path. It also composes the
factory, operations, and cleanup in one `Result.gen` workflow.

The startup path has one extra Result step. A caller with prevalidated options
can call `.unwrap()` when invalid options prove a broken invariant.

### Design 2: Direct factory and Result operations

The factory returns the client directly. It throws local option errors during
construction. Remote operations return Result values.

```ts
await using bridge = createOdooBridge(options);
const batch = await bridge.readCatalogBatch({ limit: 100 });
```

This design makes startup shorter. It creates two failure policies in one
interface. Invalid options throw, while all remote failures return `Err`.

The split also prevents a complete `Result.gen` workflow from owning client
creation. This design is not selected.

### Design 3: Result client with a throwing view

The default methods return Result values. A nested `throwing` view returns
plain promises.

```ts
const safe = await bridge.readCatalogBatch();
const plain = await bridge.throwing.readCatalogBatch();
```

This design supports both policies on one runtime. It doubles the operation
surface and makes the caller choose a policy for each call. Better Result
already provides `.unwrap()` for callers that assert success.

This design is not selected.

### Design 4: Separate factories or package entries

One factory returns a throwing client. Another factory returns a Result
client. A package-entry variation puts the Result client under `/result`.

This design keeps each client internally consistent. It duplicates public
concepts, examples, lifecycle documentation, and package tests. The repository
does not require backward compatibility for the current interface.

This design is not selected.

### Design 5: Verified capability

The contract check returns a second client that has the catalog read method.
The type prevents catalog reads before a successful check.

This design is useful when every read requires a prior check. The Bridge
Contract check is a rollout gate. Normal catalog jobs must not repeat it.

The second capability would add lifecycle and ownership questions without a
matching invariant. This design is not selected.

## Selected public interface

The root exports Better Result's `Result` value. It also exports a local
`OdooBridgeResult` type alias.

```ts
import type { Result as BetterResult } from "better-result";

export { Result } from "better-result";

export type OdooBridgeResult<A, E> = BetterResult<A, E>;

export const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
```

### Options

```ts
export interface OdooBridgeOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly database: string;
  readonly requestTimeoutMs?: number | undefined;
}

export interface OdooBridgeCallOptions {
  readonly signal?: AbortSignal | undefined;
}

export interface OdooBridgeReadCatalogBatchOptions extends OdooBridgeCallOptions {
  readonly cursor?: SourceRevision | null | undefined;
  readonly limit?: number | undefined;
}
```

The Promise adapter uses one options object for a catalog read. A signal-only
call does not need an `undefined` placeholder.

```ts
await bridge.readCatalogBatch({ signal });
```

The native Effect method keeps `CatalogBatchInput` separate. Effect owns
interruption, so its domain input does not include `AbortSignal`.

### Client

```ts
export interface OdooBridgeGateway {
  readonly readCatalogBatch: (
    options?: OdooBridgeReadCatalogBatchOptions,
  ) => Promise<OdooBridgeResult<CatalogBatch, OdooBridgeReadCatalogBatchError>>;
}

export interface OdooBridgeClient extends OdooBridgeGateway {
  readonly checkContract: (
    options?: OdooBridgeCallOptions,
  ) => Promise<OdooBridgeResult<BridgeContractCheck, OdooBridgeCheckContractError>>;

  readonly close: () => Promise<void>;
  readonly [Symbol.asyncDispose]: () => Promise<void>;
}

export function createOdooBridge(
  options: OdooBridgeOptions,
): OdooBridgeResult<OdooBridgeClient, OdooBridgeConfigurationError>;
```

The factory validates and normalizes local options. It makes no network
request. It creates the managed runtime only after successful validation.

`close()` is idempotent. Cleanup defects can reject its promise. It has no
expected failure type.

## Error model

Each expected failure is a Better Result `TaggedError`. Each tag includes the
`OdooBridge` prefix to prevent collisions in application error unions.

The proposed classes are:

```ts
InvalidOdooBridgeOptions;
PrivateOdooRouteRequired;
InvalidSourceRevision;
InvalidCatalogBatchInput;
OdooAuthenticationFailed;
OdooPermissionDenied;
UnexpectedOdooStatus;
OdooRequestTimedOut;
OdooTransportFailed;
InvalidCatalogBatchResponse;
InvalidDocumentationIndexResponse;
InvalidModelDocumentationResponse;
OdooBridgeContractMissing;
OdooBridgeContractNotModel;
OdooBridgeContractNotReadonly;
OdooCatalogFixtureEmpty;
OdooBridgeCallAborted;
OdooBridgeClientClosed;
```

Tags use the class names. Consumers can use `error._tag`, exhaustive
`error.match(...)`, or `isOdooBridgeError(error)`.

```ts
export interface OdooBridgeValidationIssue {
  readonly path: ReadonlyArray<string | number>;
  readonly expected: string;
}
```

Input and response errors include sanitized validation issues. They do not
include the rejected value, raw response body, credentials, or unrestricted
URL.

Operation aliases list only possible failures:

```ts
export type OdooBridgeConfigurationError = InvalidOdooBridgeOptions | PrivateOdooRouteRequired;

export type OdooBridgeReadCatalogBatchError =
  | InvalidCatalogBatchInput
  | OdooAuthenticationFailed
  | OdooPermissionDenied
  | UnexpectedOdooStatus
  | OdooRequestTimedOut
  | OdooTransportFailed
  | InvalidCatalogBatchResponse
  | OdooBridgeCallAborted
  | OdooBridgeClientClosed;

export type OdooBridgeCheckContractError =
  | OdooAuthenticationFailed
  | OdooPermissionDenied
  | UnexpectedOdooStatus
  | OdooRequestTimedOut
  | OdooTransportFailed
  | InvalidCatalogBatchResponse
  | InvalidDocumentationIndexResponse
  | InvalidModelDocumentationResponse
  | OdooBridgeContractMissing
  | OdooBridgeContractNotModel
  | OdooBridgeContractNotReadonly
  | OdooCatalogFixtureEmpty
  | OdooBridgeCallAborted
  | OdooBridgeClientClosed;
```

The root also exports the union of all bridge errors and a structural guard:

```ts
export type OdooBridgeError =
  | OdooBridgeConfigurationError
  | OdooBridgeReadCatalogBatchError
  | OdooBridgeCheckContractError
  | InvalidSourceRevision;

export function isOdooBridgeError(value: unknown): value is OdooBridgeError;
```

The guard checks stable tags and the error shape. It does not use only
`instanceof`. This rule supports mixed ESM and CommonJS module graphs.

### Cancellation and closure

The Result boundary has no interruption channel. It maps caller interruption
to `OdooBridgeCallAborted`. It maps calls interrupted by `close()` to
`OdooBridgeClientClosed`.

This rule makes every public operation fulfill with Result for all expected
outcomes. It also keeps `Result.await`, `Result.allAsync`, and
`Result.partitionAsync` safe for abortable bridge calls.

Unknown Effect defects reject the Promise. The adapter wraps them in `Panic`
with the original cause. A Result workflow can therefore distinguish expected
bridge failures from implementation defects.

## Contract types

The root publishes plain declarations. These declarations do not import
`Effect` or `Schema`.

The scalar types use package-owned brands:

```ts
export type OdooId = number & OdooIdBrand;
export type OdooIntegrationKey = string & OdooIntegrationKeyBrand;
export type OdooDateTime = string & OdooDateTimeBrand;
export type OdooDecimal = string & OdooDecimalBrand;
export type CurrencyCode = string & CurrencyCodeBrand;
```

The brands apply only to values that cross the module boundary. Names,
descriptions, barcodes, and Internal References stay structural strings.

`CatalogItem.variants` is a non-empty tuple:

```ts
export interface CatalogItem {
  readonly template: CatalogTemplate;
  readonly variants: readonly [CatalogVariant, ...CatalogVariant[]];
}
```

The root provides a decoder for a persisted Source Revision:

```ts
export function parseSourceRevision(
  input: unknown,
): OdooBridgeResult<SourceRevision, InvalidSourceRevision>;
```

The `/contract` entry exports Effect Schema codecs. It also exports explicit
encoded aliases:

```ts
export type SourceRevisionEncoded = Schema.Schema.Encoded<typeof SourceRevisionSchema>;

export type CatalogBatchEncoded = Schema.Schema.Encoded<typeof CatalogBatchSchema>;
```

## Consumer examples

### One operation

```ts
const created = createOdooBridge({
  apiKey: ENV.ODOO_API_KEY,
  baseUrl: ENV.ODOO_BASE_URL,
  database: ENV.ODOO_DATABASE,
});

if (created.status === "error") {
  console.error(created.error.message);
  return;
}

await using bridge = created.value;
const result = await bridge.readCatalogBatch({ limit: 100 });

if (result.status === "error") {
  console.error(`${result.error._tag}: ${result.error.message}`);
  return;
}

await importCatalogBatch(result.value.items);
```

### Complete workflow

```ts
const result = await Result.gen(async function* () {
  await using bridge = yield* createOdooBridge({
    apiKey: ENV.ODOO_API_KEY,
    baseUrl: ENV.ODOO_BASE_URL,
    database: ENV.ODOO_DATABASE,
  });

  const contract = yield* Result.await(bridge.checkContract());
  const batch = yield* Result.await(
    bridge.readCatalogBatch({
      cursor: null,
      limit: 100,
    }),
  );

  return Result.ok({ batch, contract });
});

if (result.status === "error") {
  reportOdooBridgeError(result.error);
  return;
}

useCatalogBatch(result.value.batch);
```

The generator closes after the first error. The bridge therefore closes when
the contract check or catalog read returns `Err`.

### Persisted Source Revision

```ts
const revision = parseSourceRevision(JSON.parse(storedRevision));

if (revision.status === "error") {
  await resetCatalogCursor();
  return;
}

const batch = await bridge.readCatalogBatch({
  cursor: revision.value,
  limit: 100,
});
```

## Native Effect interface

The Effect service uses the same domain error classes in its `E` channel. Its
method types remain exact:

```ts
interface Interface {
  readonly checkContract: () => Effect.Effect<
    BridgeContractCheck,
    OdooBridgeCheckContractEffectError
  >;

  readonly readCatalogBatch: (
    input?: CatalogBatchInput,
  ) => Effect.Effect<CatalogBatch, OdooBridgeReadCatalogBatchEffectError>;
}
```

The Effect aliases exclude `OdooBridgeCallAborted` and
`OdooBridgeClientClosed`. Native Effect uses interruption and scope for those
outcomes.

The internal `executeJson<S>` stays generic in its response schema. The public
service and gateway stay concrete.

## Package surface

The package has three entries:

```text
@mze-store/odoo-bridge           Result client and plain contract types
@mze-store/odoo-bridge/effect    Native Effect service and exact errors
@mze-store/odoo-bridge/contract  Effect Schema codecs and encoded types
```

There is no `/promise`, `/result`, generic transport, or throwing client entry.

The root exports only the Better Result values needed for bridge workflows.
It does not become a general Better Result barrel.

## Implementation constraints

The implementation must include these checks:

1. Pin `better-result@3.0.1`.
2. Bundle Better Result into the CommonJS output.
3. Prove that both ESM and CommonJS root entries load.
4. Prove that CommonJS output has no external Better Result `require` call.
5. Compile root declarations with the Medusa TypeScript configuration.
6. Prove exact operation error unions with type tests.
7. Prove `Result.gen` inference for the documented workflow.
8. Prove cleanup after success, `Err`, abort, and explicit close.
9. Prove structural bridge-error detection across ESM and CommonJS builds.
10. Prove omitted and explicit `undefined` options have the same behavior.
11. Prove that non-empty variants stay non-empty in the decoded type.
12. Prove that root declarations do not contain Effect or Schema imports.

The package README and exported TSDoc must document the route allowlist,
timeout unit, timeout scope, contract-check cost, cursor ownership, error
policy, cancellation, closure, and cleanup.

The architecture document must name the root Result interface. Superseded
research documents must carry a clear obsolete status or be removed.
