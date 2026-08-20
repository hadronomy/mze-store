# Effect-first Odoo bridge interface design

**Date checked:** 2026-08-20  
**Status:** Implemented in the package. Design C remains deferred.

## Answer about Effect

Effect instability was one reason to keep it out of the first design. It was
not the main reason.

The other reasons were the Medusa CJS boundary, the cost of exposing
`Effect<A, E, R>` to every caller, the need for a clear configuration and
runtime lifecycle, and the learning cost of layers for a small bridge.

With Effect accepted as a first-class dependency, those costs become design
inputs. The package can use Effect where it adds value: typed failures,
cancellation, timeouts, retry schedules, streams, resource scope, tracing, and
test layers.

The Promise API remains useful for Medusa. It is an edge adapter. It is not a
vote against Effect.

## Requirements

The bridge serves two callers:

1. Effect applications that run catalog sync workflows.
2. The existing Medusa CJS script that needs a small Promise API.

The package must:

- verify the Odoo documentation and the read-only method before catalog access;
- expose the fixed `mze.medusa.bridge/read_catalog_batch` contract;
- reject arbitrary model, method, path, and body input;
- decode every response into the MZE catalog contract;
- support one-page reads and lazy cursor pagination;
- support cancellation and request timeouts;
- support injected requests and test transports;
- apply bounded transient retries only to approved operations;
- detect repeated cursors and page or item limits;
- keep API keys, headers, response bodies, and Odoo debug data out of errors;
- provide operation names and safe status data for logs and spans;
- keep the CJS edge free from Effect types;
- make the common catalog sync short and hard to misuse.

Use Effect `Schema` as the single contract source. The package uses the same
schemas through the Effect runtime and the Promise edge.

## JSON codec decision

The implementation uses `Schema.toCodecJson` at the HTTP boundary. Response
decoding uses `Schema.decodeUnknownEffect(Schema.toCodecJson(schema))`, and
request validation uses the same JSON codec path. This matters when a schema
later uses an Effect type with a JSON representation, such as `Schema.Date`:
the bridge will decode the wire value instead of treating the value as an
already-decoded JavaScript object.

The current catalog contract keeps timestamps and decimal values as validated
strings. That preserves the Odoo wire contract. The JSON codec seam still
allows a future decoded domain type without changing the transport code.

This follows the Effect HTTP and RPC pattern. Those APIs lower payload schemas
through `Schema.toCodecJson` before decoding or encoding JSON. See the
[Effect Schema guide](https://effect.plants.sh/schema/) and the
[Effect HTTP API issue that documents this boundary](https://github.com/Effect-TS/effect-smol/issues/1630).

## Design A: verified Effect service with a scoped catalog session

This design uses one deep service operation. The caller opens a verified
session, then reads pages or items from a lazy stream.

### Interface

```ts
import type { Context, Duration, Effect, Layer, Redacted, Scope, Stream } from "effect";

type DurationInput = Duration.DurationInput;
type RetryPolicy = {
  readonly maxAttempts: number;
  readonly baseDelay: DurationInput;
  readonly maxDelay: DurationInput;
};

export type OdooBridgeSettings = {
  readonly baseUrl: string;
  readonly database: string;
  readonly apiKey: Redacted.Redacted<string>;
  readonly requestTimeout?: DurationInput;
  readonly maxAttempts?: number;
  readonly maxPages?: number;
  readonly maxItems?: number;
};

export type CatalogReadOptions = {
  readonly pageSize?: number;
  readonly cursor?: OdooCatalogCursor | null;
  readonly maxPages?: number;
  readonly maxItems?: number;
  readonly retry?: "default" | "none" | RetryPolicy;
  readonly timeout?: DurationInput;
};

export type ReadAllCatalogOptions = Omit<CatalogReadOptions, "cursor">;
export type CallOptions = Pick<CatalogReadOptions, "timeout"> & {
  readonly signal?: AbortSignal;
};

export type OdooCatalogPage = {
  readonly sequence: number;
  readonly requestCursor: OdooCatalogCursor | null;
  readonly batch: OdooCatalogBatch;
  readonly attempts: number;
};

export interface OdooCatalogSession {
  readonly contract: OdooReadOnlyContract;
  readonly pages: (options?: CatalogReadOptions) => Stream.Stream<OdooCatalogPage, OdooBridgeError>;
  readonly items: (options?: CatalogReadOptions) => Stream.Stream<OdooCatalogItem, OdooBridgeError>;
}

export interface OdooBridgeShape {
  readonly open: (
    options?: OpenSessionOptions,
  ) => Effect.Effect<OdooCatalogSession, OdooBridgeError, Scope.Scope>;
}

export class OdooBridge extends Context.Service<OdooBridge, OdooBridgeShape>()(
  "@mze-store/odoo-bridge/OdooBridge",
) {}

export const layer: (settings: OdooBridgeSettings) => Layer.Layer<OdooBridge, OdooBridgeError>;

export type OpenSessionOptions = {
  readonly timeout?: DurationInput;
};
```

### Usage

```ts
const syncCatalog = Effect.gen(function* () {
  const bridge = yield* OdooBridge;
  const session = yield* bridge.open();

  yield* session.items({ pageSize: 100 }).pipe(Stream.runForEach((item) => syncProduct(item)));
}).pipe(Effect.scoped, Effect.provide(OdooBridge.layer(settings)), Effect.timeout("5 minutes"));

await Effect.runPromise(syncCatalog, { signal: request.signal });
```

The caller receives a verified session. `open` reads the bearer documentation,
checks the model and method, checks `readonly`, and reads one typed fixture.
The session stores that contract and the first page. The first page is not
discarded.

The `pages` stream is canonical because it preserves cursor, page number, item
count, and retry attempts. The `items` stream is the short path for consumers
that only need catalog items.

### Hidden internals

The service owns endpoint validation, route construction, headers, response
decoding, the documentation gate, cursor progression, retry schedules, timeout
composition, cycle detection, page limits, and error redaction.

The default HTTP implementation can use Effect's HTTP client. The service
exposes a small transport service for tests, not the HTTP client types.

```ts
export interface OdooTransportShape {
  readonly request: (request: Request) => Effect.Effect<Response, OdooTransportError>;
}

export class OdooTransport extends Context.Service<OdooTransport, OdooTransportShape>()(
  "@mze-store/odoo-bridge/OdooTransport",
) {}
```

The live layer builds an authenticated `Request` before it calls the
transport. A test layer records requests or returns fixed Odoo responses.

### Trade-offs

This is a deep interface. One `open` call hides most operational policy. The
stream models a large catalog and gives backpressure and interruption.

The caller must understand `Effect`, `Layer`, `Stream`, and `Scope`. A one-page
health check has more ceremony than a direct Promise method. The Promise edge
addresses that cost for Medusa.

## Design B: common-case Effect operation with an explicit advanced stream

This design makes the most common action one call: verify the contract and
return all catalog items. It keeps the stream as an advanced operation.

### Interface

```ts
export interface OdooBridgeShape {
  readonly verify: Effect.Effect<OdooReadOnlyContract, OdooBridgeError>;

  readonly readAllCatalog: (
    options?: ReadAllCatalogOptions,
  ) => Effect.Effect<readonly OdooCatalogItem[], OdooBridgeError>;

  readonly readCatalogPages: (
    options?: CatalogReadOptions,
  ) => Stream.Stream<OdooCatalogPage, OdooBridgeError>;
}

export class OdooBridge extends Context.Service<OdooBridge, OdooBridgeShape>()(
  "@mze-store/odoo-bridge/OdooBridge",
) {}
```

### Usage

```ts
const bridge = yield * OdooBridge;
const items =
  yield *
  bridge.readAllCatalog({
    pageSize: 100,
    maxPages: 100,
    maxItems: 100_000,
    timeout: "2 minutes",
  });
```

The operation runs the documentation gate, reads pages, checks cursor
progress, and stops only at `next_cursor: null`. It fails if `maxPages` or
`maxItems` is reached before the catalog ends.

The stream is available when the caller needs page metadata or large-catalog
backpressure:

```ts
const bridge = yield * OdooBridge;

yield *
  bridge.readCatalogPages({ pageSize: 100 }).pipe(
    Stream.tap((page) => recordPage(page.sequence, page.attempts)),
    Stream.mapConcat((page) => page.batch.items),
    Stream.runForEach((item) => syncProduct(item)),
  );
```

### Hidden internals

The service hides the same protocol details as Design A. `readAllCatalog`
builds the page stream and collects it. The collection limit is explicit so the
caller can see the memory cost.

### Trade-offs

This design gives the best first-use DX. A caller can complete a full sync with
one operation. The array result can consume substantial memory, so the stream
must remain a first-class path.

The service has more public methods than Design A. `readAllCatalog` can also
encourage callers to collect data when streaming uses less memory.

## Design C: typed query algebra with an Effect interpreter

This design treats each supported Odoo read as a typed query value. The
interpreter maps query values to fixed operations. Future operations extend a
closed union instead of exposing arbitrary RPC.

### Interface

```ts
export type OdooReadQuery = CatalogPageQuery;

export type CatalogPageQuery = {
  readonly _tag: "CatalogPage";
  readonly input: OdooCatalogBatchRequest;
};

export const OdooQuery = {
  catalog: {
    page(input?: OdooCatalogBatchInput): CatalogPageQuery;
  },
};

export interface VerifiedOdooBridgeShape {
  readonly contract: OdooReadOnlyContract;
  readonly run: (
    query: OdooReadQuery,
    options?: CallOptions,
  ) => Effect.Effect<OdooCatalogBatch, OdooBridgeError>;
  readonly catalog: {
    readonly items: (
      options?: CatalogReadOptions,
    ) => Stream.Stream<OdooCatalogItem, OdooBridgeError>;
  };
}

export interface OdooBridgeShape {
  readonly verify: (
    options?: CallOptions,
  ) => Effect.Effect<VerifiedOdooBridgeShape, OdooBridgeError>;
}
```

### Usage

```ts
const bridge = yield * OdooBridge;
const verified = yield * bridge.verify({ timeout: "5 seconds" });

const page = yield * verified.run(OdooQuery.catalog.page({ limit: 50 }));
```

The query union can grow to include approved read operations such as stock or
invoice reads. It never accepts a model string, method string, URL, or caller
body.

### Hidden internals

The interpreter owns the operation registry, schemas, route construction,
headers, retries, and error mapping. The query type does not expose transport
details.

### Trade-offs

This design gives the strongest extension seam. It fits a bridge that will
serve many typed read operations and several workflow interpreters.

It is less pleasant for the current single catalog contract. The query value
adds ceremony before a page read. The union and result mapping also add type
machinery that a small domain does not yet need.

## Comparison

Design A has the deepest interface. It hides verification, transport policy,
pagination, and resource lifetime behind `open`. It gives the best operational
model for a long-running sync worker.

Design B has the shortest path for the common case. It makes a full catalog
read one operation and keeps the page stream for advanced callers. It fits a
small application with one primary sync job.

Design C gives the best extension model. It also creates the most ceremony and
the largest public type surface. The current bridge has one read contract, so
the query algebra is premature.

The main choice is between Design A and Design B. Both use Effect for real
policy. Design A treats the session and stream as the product. Design B treats
the collected catalog as the product and the stream as an escape hatch.

## Recommended interface

Use Design B as the core. Include Design A's verified session and lazy streams
for callers that need a long-running sync or page-level control.

### Canonical Effect API

```ts
export interface OdooBridgeShape {
  readonly verify: (options?: CallOptions) => Effect.Effect<OdooReadOnlyContract, OdooBridgeError>;

  readonly open: (options?: CallOptions) => Effect.Effect<OdooCatalogSession, OdooBridgeError>;

  readonly readAllCatalog: (
    options?: ReadAllCatalogOptions,
  ) => Effect.Effect<readonly OdooCatalogItem[], OdooBridgeError>;

  readonly readCatalogPages: (
    options?: CatalogReadOptions,
  ) => Stream.Stream<OdooCatalogPage, OdooBridgeError>;
}

export interface OdooCatalogSession {
  readonly contract: OdooReadOnlyContract;
  readonly pages: (options?: CatalogReadOptions) => Stream.Stream<OdooCatalogPage, OdooBridgeError>;
  readonly items: (options?: CatalogReadOptions) => Stream.Stream<OdooCatalogItem, OdooBridgeError>;
}
```

The common case is:

```ts
const bridge = yield * OdooBridge;
const items =
  yield *
  bridge.readAllCatalog({
    pageSize: 100,
    maxPages: 100,
    maxItems: 100_000,
  });
```

The streaming case is:

```ts
const bridge = yield * OdooBridge;
const session = yield * bridge.open();

yield *
  session.pages({ pageSize: 100 }).pipe(
    Stream.mapConcat((page) => page.batch.items),
    Stream.runForEach((item) => syncProduct(item)),
  );
```

The service layer caches the verified contract when no call options are given.
`verify` and `open` share the gate. A call with a signal or timeout passes those
options through the documentation gate before it reads the fixture page.

### Timeout and cancellation

Use two timeout levels:

- `requestTimeout` limits one Odoo HTTP request.
- `timeout` limits the full verification or catalog workflow.

Effect callers use `Effect.timeout` or a per-request option. The caller passes
an `AbortSignal` to `Effect.runPromise` when the work belongs to an HTTP
request, job, or shutdown scope.

The HTTP adapter receives the interrupted fiber signal. It passes that signal
to `fetch`. The stream stops between pages. The active request aborts.

The Promise edge exposes the same model:

```ts
export type OdooRequest = (input: string, init: RequestInit) => Promise<Response>;

export interface PromiseBridgeOptions {
  readonly baseUrl: string;
  readonly database: string;
  readonly apiKey: string;
  readonly request?: OdooRequest;
}

export interface PromiseBridge {
  readonly verify: (options?: {
    readonly signal?: AbortSignal;
    readonly timeoutMs?: number;
  }) => Promise<OdooReadOnlyContract>;
  readonly readCatalogPages: (
    options?: CatalogReadOptions & {
      readonly signal?: AbortSignal;
      readonly timeoutMs?: number;
    },
  ) => AsyncIterable<OdooCatalogPage>;
  readonly readAllCatalog: (
    options?: ReadAllCatalogOptions & {
      readonly signal?: AbortSignal;
      readonly timeoutMs?: number;
    },
  ) => Promise<readonly OdooCatalogItem[]>;
}

export const createPromiseBridge: (options: PromiseBridgeOptions) => PromiseBridge;
```

The Promise bridge runs the Effect service through an internal runtime. Effect
types do not cross the CJS package boundary. The injected request function is
the test seam for Medusa and for small unit tests.

### Retry policy

Use a safe default policy inside the Effect layer:

- retry transport failures;
- retry `408`, `429`, `500`, `502`, `503`, and `504`;
- keep retry delays bounded;
- use a small exponential backoff with jitter;
- stop after a finite attempt count;
- never retry authentication, permission, contract, decode, pagination, or
  cancellation errors.

The catalog POST is retryable only because the verified method is a read-only
normalized read. The package must not infer retry safety from HTTP method alone.

### Error model

Use `Schema.TaggedError` for the Effect error channel. Keep the public union
small:

```ts
type OdooBridgeError =
  | OdooConfigurationError
  | OdooAuthenticationError
  | OdooPermissionError
  | OdooContractError
  | OdooTransportError
  | OdooTimeoutError
  | OdooDecodeError
  | OdooPaginationError;
```

Every error includes an operation name and safe status data. A retryable error
can include an attempt count. Errors never include an API key, authorization
header, response body, Odoo debug payload, or unrestricted request URL.

### Configuration and injection

Provide plain settings. Add an Effect `Config` helper when the package owns an
application configuration boundary:

```ts
export const layer: (
  settings: OdooBridgeSettings,
) => Layer.Layer<OdooBridge, OdooBridgeError, OdooTransport>;

export const layerConfig: (
  config: Config.Config<OdooBridgeSettings>,
) => Layer.Layer<OdooBridge, OdooBridgeError | ConfigError, OdooTransport>;
```

The application owns environment loading. The package receives a redacted API
key. It does not read `process.env`. The current implementation defers
`layerConfig` until an application needs it.

Inject the HTTP transport through a layer. Use the default fetch transport in
production. Use a fake transport in tests. Keep `effect/unstable/http` imports
inside the transport adapter so the domain service does not expose unstable
HTTP types.

### Package exports

Use explicit subpaths:

```text
@mze-store/odoo-bridge          Effect service and domain helpers
@mze-store/odoo-bridge/promise  Promise and CJS edge
@mze-store/odoo-bridge/contract Shared catalog types and schemas
```

The Medusa script imports `/promise`. Effect applications import the root
service. This gives each caller one programming model.

### Test design

Use the repository test runner and a fake transport layer. Test the policy, not
a live Odoo server:

- documentation requests run before catalog requests;
- missing and non-read-only methods fail with typed contract errors;
- private endpoints are enforced;
- bearer keys never appear in errors or logs;
- request timeout interrupts the transport;
- `AbortSignal` reaches the injected request;
- transient failures retry within the attempt bound;
- `401` and `403` do not retry;
- retry delays stay bounded;
- repeated cursors fail;
- page and item limits fail without silent truncation;
- streams stop after interruption;
- the Promise facade works from a CJS smoke test;
- the packed Effect and Promise entry points load from ESM and CJS.

## Final recommendation

Make Effect the source of truth for the bridge domain and workflow policy.
Expose a scoped verified session with page and item streams, plus
`readAllCatalog` for the common case. Keep a thin Promise/CJS edge with the
same operations and explicit `AbortSignal` support.

The implementation uses Effect for the parts that need composition. It keeps a
thin Promise edge for Medusa and keeps every route, method, retry rule, and
decoder inside the bridge.
