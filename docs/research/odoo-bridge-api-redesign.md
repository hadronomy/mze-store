# Odoo bridge API redesign

**Status:** Superseded on 2026-08-21

The implemented interface is in
[`odoo-bridge-effect-result-interface.md`](./odoo-bridge-effect-result-interface.md).
This earlier design used one nested error wrapper and a Promise rejection
channel. Keep it only as design history.

**Issue:** [#132](https://github.com/hadronomy/mze-store/issues/132)

**Supersedes:** [Odoo bridge DX design](./odoo-bridge-dx-design.md) and
[Odoo bridge Effect interface design](./odoo-bridge-effect-interface-design.md)

This design follows the [Effect v4 boundary research](./odoo-bridge-effect-v4-boundary-redesign.md).
It also follows the ownership rules in issue #131 and ADR-0030.

## Decision

Expose two small public surfaces over one implementation.

- The package root is the plain Promise API for Medusa.
- The `/effect` entry point is the native Effect API.
- The `/contract` entry point contains the shared Bridge Contract codecs and types.

Expose two operations now:

- `checkContract` proves the rollout gate.
- `readCatalogBatch` reads one bounded Catalog Batch.

Medusa owns cursor progression, retries, reconciliation, and durable state. The
package does not expose a full-catalog read, a page stream, a session, or a
generic Odoo call.

The rollout check is an explicit deployment action. A normal Catalog Batch read
does not repeat the documentation check. The Private Odoo Route and option
invariants still apply to every operation.

## Research basis

The pinned Effect release is `effect@4.0.0-rc.109`. Its service API uses
`Context.Service`. Its first-party clients expose an `Interface`, `make`, and
`layer`. See the [pinned Context source](../../node_modules/effect/src/Context.ts)
and the [current Context source](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Context.ts).

The Effect HTTP client already owns immutable requests, authentication
transforms, status checks, Schema-based JSON bodies, Schema-based responses,
and interruption. The bridge must compose these primitives. It must not build a
second HTTP abstraction. See the [pinned HTTP client source](../../node_modules/effect/src/unstable/http/HttpClient.ts)
and the [current HTTP client source](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/unstable/http/HttpClient.ts).

`ManagedRuntime` builds one layer context, reuses it across calls, and owns its
scope. Its `runPromise` accepts an `AbortSignal`. The plain client must create
one managed runtime and dispose it. See the [pinned ManagedRuntime source](../../node_modules/effect/src/ManagedRuntime.ts)
and the [current ManagedRuntime source](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/ManagedRuntime.ts).

Effect first-party clients keep the transport as a service requirement. The
OpenRouter client is a close example of the `Interface`, `make`, `layer`, and
HTTP client shape. See [OpenRouterClient](https://github.com/Effect-TS/effect/blob/main/packages/ai/openrouter/src/OpenRouterClient.ts).

## Public package entries

```text
@mze-store/odoo-bridge           Promise client and plain contract types
@mze-store/odoo-bridge/effect    Native Effect service, accessors, and layer
@mze-store/odoo-bridge/contract  Bridge Contract codecs, constants, and types
```

Remove the `/promise` entry. The root is the common Medusa entry, so an extra
subpath adds no value.

Both root entries keep the current ESM and CommonJS builds. This preserves the
Medusa CommonJS boundary from ADR-0012.

## Shared Bridge Contract

The Odoo JSON keys remain snake case on the wire. Consumers receive normalized
camel-case values. Use `Schema.encodeKeys` for this boundary. Do not maintain a
second manual mapper.

The Source Revision is a named type. It is not an opaque string.

```ts
export const SourceRevisionSchema = Schema.Struct({
  productId: PositiveInt,
  changedAt: OdooDateTime,
}).pipe(
  Schema.encodeKeys({
    productId: "id",
    changedAt: "write_date",
  }),
);

export type SourceRevision = Schema.Schema.Type<typeof SourceRevisionSchema>;

export const CatalogBatchRequestSchema = Schema.Struct({
  cursor: Schema.NullOr(SourceRevisionSchema),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
});

export interface CatalogBatchInput {
  readonly cursor?: SourceRevision | null;
  readonly limit?: number;
}

export const CatalogBatchSchema = Schema.Struct({
  contractVersion: Schema.Literal(ODOO_CATALOG_CONTRACT_VERSION),
  items: Schema.Array(CatalogItemSchema).check(Schema.isMaxLength(100)),
  nextCursor: Schema.NullOr(SourceRevisionSchema),
}).pipe(
  Schema.encodeKeys({
    contractVersion: "contract_version",
    nextCursor: "next_cursor",
  }),
);

export type CatalogBatch = Schema.Schema.Type<typeof CatalogBatchSchema>;
```

Apply the same rule to nested values. Examples include `integrationKey`,
`attributeValues`, `internalReference`, `saleOk`, `taxIds`, and `writeDate`.
The encoded form keeps the exact Odoo field names.

`CatalogBatchInput` is the call input. The implementation normalizes omitted
values to `{ cursor: null, limit: 100 }` before Schema encoding. The contract
check always uses `{ cursor: null, limit: 1 }`.

The check returns a small safe report and the normalized fixture:

```ts
export interface BridgeContractCheck {
  readonly model: typeof ODOO_BRIDGE_MODEL;
  readonly method: typeof ODOO_BRIDGE_METHOD;
  readonly contractVersion: typeof ODOO_CATALOG_CONTRACT_VERSION;
  readonly fixture: CatalogBatch;
}
```

Documentation response schemas stay private. They are evidence used by the
check, not part of the Bridge Contract.

## Native Effect API

The native entry follows the module shape used in `tooling/mze` and in Effect
first-party clients.

```ts
import type { Duration, Effect, Layer, Redacted } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";

export interface Options {
  readonly apiKey: Redacted.Redacted<string>;
  readonly baseUrl: string;
  readonly database: string;
  readonly requestTimeout?: Duration.Input;
}

export interface Interface {
  readonly checkContract: () => Effect.Effect<BridgeContractCheck, OdooBridgeError>;

  readonly readCatalogBatch: (
    input?: CatalogBatchInput,
  ) => Effect.Effect<CatalogBatch, OdooBridgeError>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@mze-store/odoo-bridge/OdooBridge",
) {}

export const make: (
  options: Options,
) => Effect.Effect<Interface, OdooBridgeError, HttpClient.HttpClient>;

export const layer: (
  options: Options,
) => Layer.Layer<Service, OdooBridgeError, HttpClient.HttpClient>;

export const checkContract: Effect.Effect<BridgeContractCheck, OdooBridgeError, Service>;

export const readCatalogBatch: (
  input?: CatalogBatchInput,
) => Effect.Effect<CatalogBatch, OdooBridgeError, Service>;
```

The entry point exports the module as a namespace:

```ts
export * as OdooBridge from "./odoo-bridge.js";
```

`make` obtains `HttpClient.HttpClient` from the Effect context. It transforms
that client once with the Private Odoo Route, bearer key, database header,
accept header, and fixed status handling. `layer` uses `Layer.effect` with
`Service` and `make`.

The package does not expose an `OdooTransport` service. Effect tests provide a
fake `HttpClient.HttpClient`. Production code provides
`FetchHttpClient.layer`.

```ts
import { Effect, Redacted } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { OdooBridge } from "@mze-store/odoo-bridge/effect";

const program = Effect.gen(function* () {
  const check = yield* OdooBridge.checkContract;
  const batch = yield* OdooBridge.readCatalogBatch({
    cursor: null,
    limit: 100,
  });

  return { check, batch };
}).pipe(
  Effect.provide(
    OdooBridge.layer({
      apiKey: Redacted.make(apiKey),
      baseUrl,
      database,
    }),
  ),
  Effect.provide(FetchHttpClient.layer),
);
```

Use `Effect.fn("OdooBridge.checkContract")` and
`Effect.fn("OdooBridge.readCatalogBatch")` at the two public operation
boundaries. Native callers compose `Effect.timeout`, `Effect.retry`, tracing,
and interruption outside the bridge operation.

Native methods do not accept `AbortSignal`, `timeoutMs`, retry counts, or page
limits beyond the Bridge Contract limit. Effect already models these concerns.

## Plain Promise API

The root API uses the exact `OdooBridgeGateway` name from issue #131. Workflows
depend on that narrow interface and can replace it with a plain fake.

```ts
export interface CallOptions {
  readonly signal?: AbortSignal;
}

export interface Options {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly database: string;
  readonly requestTimeoutMs?: number;
}

export interface OdooBridgeGateway {
  readonly readCatalogBatch: (
    input?: CatalogBatchInput,
    options?: CallOptions,
  ) => Promise<CatalogBatch>;
}

export interface OdooBridgeClient extends OdooBridgeGateway, AsyncDisposable {
  readonly checkContract: (options?: CallOptions) => Promise<BridgeContractCheck>;

  readonly close: () => Promise<void>;
}

export const createOdooBridge: (options: Options) => OdooBridgeClient;
```

The public declarations contain no `Effect`, `Layer`, `Context`, `Stream`,
`Scope`, `ManagedRuntime`, `Redacted`, or Effect HTTP type.

The factory is synchronous. The runtime builds lazily on the first call.
`close` is idempotent. `[Symbol.asyncDispose]` calls `close`.

The rollout script stays small:

```ts
import { createOdooBridge } from "@mze-store/odoo-bridge";

await using bridge = createOdooBridge({
  apiKey: env.ODOO_API_KEY,
  baseUrl: env.ODOO_BASE_URL,
  database: env.ODOO_DATABASE,
});

const check = await bridge.checkContract({
  signal: AbortSignal.timeout(20_000),
});
```

A future Medusa workflow uses the gateway without any Effect knowledge:

```ts
async function importCatalog(gateway: OdooBridgeGateway, signal: AbortSignal) {
  let cursor: SourceRevision | null = null;

  for (;;) {
    const batch = await gateway.readCatalogBatch({ cursor, limit: 100 }, { signal });

    await importCatalogBatch(batch.items);

    cursor = batch.nextCursor;
    if (cursor === null) return;
  }
}
```

Medusa persists the cursor before the next workflow step. It also owns retry
schedules, attempt counts, overlap, reconciliation, and Sync Records.

### Runtime adapter

`createOdooBridge` creates one managed runtime:

```ts
const runtime = ManagedRuntime.make(
  OdooBridge.layer(effectOptions).pipe(Layer.provide(FetchHttpClient.layer)),
);
```

Every method runs the native accessor through that runtime:

```ts
runtime.runPromise(OdooBridge.readCatalogBatch(input), { signal: options?.signal });
```

Do not call `Effect.provide(layer)` inside each Promise method. That gives each
call its own layer scope. It also defeats service reuse.

The adapter passes the caller signal to `runPromiseExit`. It does not create a
second timer. Callers use `AbortSignal.timeout` when they need an operation
deadline. The configured request timeout remains the bound for one HTTP
request.

When the caller signal interrupts the fiber, the adapter rejects with the
signal reason or a standard `AbortError`. It inspects the full `Cause` before it
maps interruption. Typed bridge failures remain unchanged. Defects remain
defects.

## Error model

Use one `OdooBridgeError` wrapper with a closed reason union. This follows the
shape of Effect HTTP and SQL errors.

```ts
export type Operation = "bridge.configure" | "contract.check" | "catalog.readBatch";

export type OdooBridgeErrorReason =
  | InvalidOptions
  | InvalidCatalogBatchInput
  | PrivateOdooRouteRequired
  | TransportFailed
  | RequestTimedOut
  | AuthenticationFailed
  | PermissionDenied
  | UnexpectedStatus
  | InvalidResponse
  | BridgeContractMissing
  | BridgeContractNotModel
  | BridgeContractNotReadonly
  | CatalogFixtureEmpty;

export class OdooBridgeError extends Schema.TaggedError<OdooBridgeError>()("OdooBridgeError", {
  operation: OperationSchema,
  reason: OdooBridgeErrorReasonSchema,
}) {
  override readonly cause = this.reason;

  override get message(): string {
    return this.reason.message;
  }

  get code(): OdooBridgeErrorReason["_tag"] {
    return this.reason._tag;
  }
}
```

Each reason contains only the data needed to act on that failure. For example,
`UnexpectedStatus` contains a status code. `BridgeContractMissing` contains a
part value of `module`, `model`, or `method`. `InvalidResponse` identifies the
expected response kind.

No error contains an API key, header, response body, Odoo debug payload, or
unrestricted URL. No error contains `attempts` or a retry schedule. Those values
belong to a Sync Record.

Core interruption stays Effect interruption. Cancellation is not an
`OdooBridgeError`. Client closure is a plain client lifecycle error.

Promise consumers get a normal JavaScript error:

```ts
try {
  await bridge.readCatalogBatch();
} catch (error) {
  if (error instanceof OdooBridgeError) {
    switch (error.code) {
      case "AuthenticationFailed":
      case "PermissionDenied":
        // Mark this rollout or Sync Record as blocked.
        break;
    }
  }
}
```

Effect consumers can catch the wrapper tag, then match on `error.reason._tag`.

## Check semantics

`checkContract` performs this sequence once per call:

1. Validate the options and require a Private Odoo Route.
2. Read the authenticated documentation index.
3. Require the bridge module and model.
4. Read the model documentation.
5. Require `read_catalog_batch` with `model` and `readonly` markers.
6. Call the method with `{ cursor: null, limit: 1 }`.
7. Decode the Catalog Batch and require one item.

The operation creates or changes no Odoo record. It returns the normalized
fixture and fixed contract identity. It does not return raw documentation.

Do not cache this result. A rollout check must observe the current deployment.
Do not run this check before each Catalog Batch read. Documentation availability
is a rollout gate, not a production read dependency.

## Catalog Batch semantics

`readCatalogBatch` performs one reviewed JSON-2 method call. It accepts a Source
Revision and a limit. It returns one normalized Catalog Batch and its next
Source Revision.

The method does not:

- advance or persist a cursor
- read every Catalog Batch
- retry a request
- reconcile records
- create a Sync Record
- hide a documentation check
- accept a model, method, route, or arbitrary body

Future Bridge Contract operations become named gateway methods. Examples are
`readAllocationBatch`, `acceptOrder`, and `createCreditNote`. Do not add a
generic `run`, `call`, or `request` escape hatch.

## Internal module shape

```text
src/
  contract/
    catalog.ts          public codecs, constants, and types
    index.ts            /contract entry point
  internal/
    catalog.ts          one fixed JSON-2 call
    contract-check.ts   documentation and fixture workflow
    http-client.ts      authenticated Effect HTTP client transforms
    documentation.ts    private documentation codecs
  error.ts              public error wrapper and reason union
  odoo-bridge.ts        Effect Interface, Service, accessors, make, layer
  client.ts             ManagedRuntime Promise adapter
  effect.ts             /effect entry point
  index.ts              Promise root entry point
```

The Effect module does not import the Promise adapter. The Promise adapter uses
only native Effect accessors. Contract codecs and error values are shared.

## Designs considered

### Design 1: one rollout function

This design exposes one Effect `checkContract` operation and one Promise
`checkContract` function. It has no client lifecycle and no Catalog Batch
gateway.

This is the smallest issue #132 surface. It is also too small for the boundary
defined by issue #131. The next catalog work forces a package replacement or a
second construction model. It does not solve repeated non-Effect calls.

### Design 2: managed client with pagination streams

This design exposes `checkContract`, `readCatalogBatch`, and an Effect `Stream`.
The Promise client converts that stream to `AsyncIterable` with Effect's
official adapter. One managed runtime owns all calls and iterator scopes.

The runtime part is correct. The stream part puts cursor progression and
in-memory pagination back into the bridge. Issue #131 assigns those concerns to
Medusa. A durable workflow also cannot treat an iterator cursor as its source
of truth.

### Design 3: closed operation algebra

This design exposes `run(BridgeOperation)` on both surfaces. A tagged operation
value determines its result type. Private endpoint descriptors interpret the
operation.

The algebra blocks generic Odoo calls and creates one extension point. It also
adds a constructor and conditional result type to every call. Named methods are
clearer for this small, reviewed method set. They give better editor discovery
to both Effect and Promise consumers.

### Design 4: verified capability

This design exposes `checkContract`, which returns a capability that owns
`readCatalogBatch`. An unverified read is impossible by construction.

The type invariant is strong. Its operational invariant is wrong for this
system. The documentation surface is a deployment gate. It must not become a
dependency of every worker start or Catalog Batch read. A long-lived capability
also adds lifecycle state that the Bridge Contract does not need.

### Design 5: Medusa-first gateway

This design makes the root a plain `OdooBridgeGateway`. It puts the native
Effect service under `/effect`. It exposes one Catalog Batch read and one
explicit rollout check. One managed runtime backs each plain client.

This design matches the highest seam in issue #131. It keeps Effect fully
available to native consumers and fully hidden from Medusa signatures. It also
keeps workflow policy with Medusa. This is the chosen base.

## Synthesis

The final design combines three useful parts from the alternatives:

- the Medusa-first package entries and named gateway methods from design 5
- the managed runtime ownership from design 2
- the closed, fixed method set from design 3

It rejects streams, verified capabilities, generic operations, and one-shot
layer construction. The result has one core implementation, two thin public
surfaces, and one owner for each policy.

## Removed API

Delete these current exports and concepts:

- `open`
- `OdooCatalogSession`
- `pages` and `items`
- `readCatalogPages`
- `readAllCatalog`
- public `OdooTransport`
- retry options and bridge retry loops
- `maxPages` and `maxItems`
- Effect call options with `AbortSignal` or `timeoutMs`
- the `/promise` package entry
- raw documentation response types from the public contract

Do not add compatibility wrappers. This branch has no released API to preserve.

## Verification targets

The implementation must prove these properties:

- Contract codecs decode snake-case Odoo JSON to normalized camel-case values.
- Contract codecs encode the same values back to the exact Bridge Contract.
- The contract check makes the exact three requests in order.
- Each Catalog Batch call makes one request and performs no hidden retry.
- A fake Effect HTTP client can drive all core tests.
- A fake `OdooBridgeGateway` can drive Medusa workflow tests.
- One Promise client builds one managed runtime and closes it once.
- Caller cancellation reaches the active HTTP request.
- Cancellation does not hide typed failures or defects.
- Error values never expose secrets or raw Odoo responses.
- The package root loads through CommonJS and ESM.
- The `/effect` entry loads through CommonJS and ESM.

## Implementation order

1. Replace the wire-only contract with Schema codecs and normalized types.
2. Add the structured error reason union.
3. Build `make`, `Service`, accessors, and `layer` on Effect HTTP.
4. Build the managed Promise client at the package root.
5. Replace the rollout script and tests.
6. Remove the obsolete surfaces and the `/promise` entry.

Each step leaves one coherent public model. No step adds a compatibility layer.
