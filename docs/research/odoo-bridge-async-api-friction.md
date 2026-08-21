# Odoo bridge async API and DX review

**Status:** Historical audit. The audited interface was replaced on 2026-08-21.

See the implemented
[`Effect Result interface`](./odoo-bridge-effect-result-interface.md).

**Checked:** 2026-08-20

**Scope:** The public Promise API in `packages/odoo-bridge`, its generated
declarations, the native Effect boundary, and the current Medusa caller.

This note records shipped facts first. Recommendations come after the facts.
The recommendations keep the Bridge Contract closed. A generic raw Odoo
client, a generic transport, pagination, and retries remain outside this API.

## Sources

The main local sources are:

- [Promise client](../../packages/odoo-bridge/src/client.ts:8)
- [Contract schemas](../../packages/odoo-bridge/src/contract.ts:3)
- [Effect service](../../packages/odoo-bridge/src/odoo-bridge.ts:15)
- [Bridge errors](../../packages/odoo-bridge/src/error.ts:3)
- [Generated root declarations](../../packages/odoo-bridge/dist/index.d.mts)
- [Medusa contract check](../../apps/medusa/src/scripts/odoo-contract-check.ts:7)
- [ADR-0030](../adr/0030-odoo-medusa-sync-uses-a-typed-bridge-and-split-ownership.md)

The Effect facts use the pinned `effect@4.0.0-rc.109` source in
`node_modules/effect`. They also use the current Effect v4 source:

- [`ManagedRuntime`](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/ManagedRuntime.ts)
- [ManagedRuntime at a framework boundary](https://github.com/Effect-TS/effect/blob/main/ai-docs/src/04_integration/10_managed-runtime.ts)
- [`Context.Service`](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Context.ts)
- [`Effect` runners and `AbortSignal`](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Effect.ts)
- [`HttpClient`](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/unstable/http/HttpClient.ts)
- [`Schema` branding](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Schema.ts)
- [`Brand` constructors](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Brand.ts)
- [Effect v4 service migration](https://github.com/Effect-TS/effect/blob/main/migration/services.md)

The resource-lifetime facts use the [TC39 Explicit Resource Management
proposal](https://github.com/tc39/proposal-explicit-resource-management) and
the pinned TypeScript declarations in
`node_modules/typescript/lib/lib.esnext.disposable.d.ts` and
`node_modules/typescript/lib/lib.dom.d.ts`.

## Shipped Promise API

The package root exposes the Promise client. The `/effect` entry exposes the
Effect service. The `/contract` entry exposes codecs and contract types. The
package no longer exposes `/promise`.

The generated root declaration contains no `Effect`, `Layer`, `Context`,
`Stream`, `Scope`, `ManagedRuntime`, `Redacted`, or Effect HTTP type in the
direct method signatures. The declaration still imports contract and error
types whose definitions refer to `effect/Schema`. This is a transitive type
dependency, even though the Promise methods return ordinary `Promise` values.

### Factory options

`createOdooBridge` accepts one `Options` object:

| Field              | Type     | Default  | Runtime behavior                                                                                                                                                                          |
| ------------------ | -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apiKey`           | `string` | none     | The client wraps it in `Redacted`. An empty or whitespace-only value fails with `InvalidOptions`.                                                                                         |
| `baseUrl`          | `string` | none     | The value must be one of the two allowlisted Private Odoo Routes. Credentials, paths, queries, fragments, and other origins fail with `PrivateOdooRouteRequired`. A final `/` is removed. |
| `database`         | `string` | none     | The value must contain non-whitespace text. The client sends it as `X-Odoo-Database`.                                                                                                     |
| `requestTimeoutMs` | `number` | `20_000` | The value becomes an Effect duration in milliseconds. It must be finite and positive. It covers the HTTP request and response-body decoding.                                              |

The source defines these fields at
[client.ts:12](../../packages/odoo-bridge/src/client.ts:12). The route and
duration checks live at
[odoo-bridge.ts:65](../../packages/odoo-bridge/src/odoo-bridge.ts:65).

The factory captures `globalThis.fetch`. It does not accept a public fetch or
transport option. The internal test helper accepts a fetch function at
[client.ts:43](../../packages/odoo-bridge/src/client.ts:43), but that helper is
not exported from the package root.

### Client methods and lifecycle

The full Promise surface is:

```ts
interface OdooBridgeClient extends OdooBridgeGateway, AsyncDisposable {
  checkContract(options?: CallOptions): Promise<BridgeContractCheck>;
  readCatalogBatch(input?: CatalogBatchInput, options?: CallOptions): Promise<CatalogBatch>;
  close(): Promise<void>;
  [Symbol.asyncDispose](): Promise<void>;
}
```

The exact declarations live at
[client.ts:8](../../packages/odoo-bridge/src/client.ts:8).

`CallOptions` contains one field:

```ts
interface CallOptions {
  readonly signal?: AbortSignal;
}
```

The client creates one `ManagedRuntime` at construction. The runtime builds its
layer on first use, reuses the service context across calls, and disposes its
scope in `close`. The adapter passes a combined signal to
`runPromiseExit`. Its own controller lets `close` interrupt active calls. See
[client.ts:57](../../packages/odoo-bridge/src/client.ts:57) and
[client.ts:94](../../packages/odoo-bridge/src/client.ts:94).

`close` is idempotent. A call that starts after close rejects with
`OdooBridgeClientClosedError`. An active call interrupted by close rejects with
the same error. A caller abort keeps the caller's abort reason. The adapter
maps only interrupt-only Effect causes and leaves typed bridge failures and
defects intact. See [client.ts:77](../../packages/odoo-bridge/src/client.ts:77).

`await using` is supported because the client implements
`Symbol.asyncDispose`:

```ts
await using bridge = createOdooBridge({
  apiKey: env.ODOO_API_KEY,
  baseUrl: env.ODOO_BASE_URL,
  database: env.ODOO_DATABASE,
});

const check = await bridge.checkContract();
```

The syntax follows the TC39 resource-management proposal. An explicit
`await bridge.close()` remains available for hosts that do not use
`await using`.

### `readCatalogBatch`

The method performs one Odoo JSON-2 call. It does not call the documentation
routes and does not retry. The input is:

```ts
interface CatalogBatchInput {
  readonly cursor?: SourceRevision | null;
  readonly limit?: number;
}
```

Omitted values become `{ cursor: null, limit: 100 }`. The schema accepts limits
from `1` through `100`. The caller receives a decoded `CatalogBatch` with
camel-case keys. The encoder sends Odoo snake-case keys. See
[contract.ts:16](../../packages/odoo-bridge/src/contract.ts:16) and
[catalog.ts:24](../../packages/odoo-bridge/src/internal/catalog.ts:24).

The caller owns cursor persistence and progression:

```ts
let cursor: SourceRevision | null = await loadCursor();

for (;;) {
  const batch = await gateway.readCatalogBatch({ cursor, limit: 100 }, { signal });

  await importCatalogBatch(batch.items);
  await saveCursor(batch.nextCursor);

  if (batch.nextCursor === null) break;
  cursor = batch.nextCursor;
}
```

`OdooBridgeGateway` contains only `readCatalogBatch`. A Medusa workflow can
depend on this interface without owning a client, a runtime, or Effect. See
[client.ts:19](../../packages/odoo-bridge/src/client.ts:19).

### `checkContract`

`checkContract` is an explicit rollout operation. Each call performs this
sequence:

1. Validate the client options and require a Private Odoo Route.
2. Read the authenticated documentation index.
3. Require the bridge module, model, and method.
4. Read the model documentation.
5. Require the method's `model` and `readonly` markers.
6. Call the method with `{ cursor: null, limit: 1 }`.
7. Decode the fixture and require at least one catalog item.

It returns the fixed model, method, contract version, and normalized fixture.
It does not cache the result. A normal batch read does not run this check.
The implementation is at
[contract-check.ts:16](../../packages/odoo-bridge/src/internal/contract-check.ts:16).

The check is useful for deployment verification, but it is not a general
decoder for stored cursors. A Medusa job that reads a `SourceRevision` from
JSON must import `/contract` and call the Effect Schema decoder, or trust the
stored value. The Promise root has no plain `parseSourceRevision` helper.
Recommendation: add a small root decoder that returns `SourceRevision` or a
safe parse error, or document the `/contract` decoder as the supported path.
Do not expose the raw Schema issue or the stored value in a public error.

### Errors

The root exports `OdooBridgeError` and the types
`OdooBridgeErrorReason` and `OdooBridgeOperation`. The reason union has these
tags:

| Tag                         | Meaning                                              |
| --------------------------- | ---------------------------------------------------- |
| `InvalidOptions`            | A client option is empty or has an invalid duration. |
| `InvalidCatalogBatchInput`  | The cursor or limit fails the request schema.        |
| `PrivateOdooRouteRequired`  | The base URL is outside the allowlist.               |
| `TransportFailed`           | The request failed before a response arrived.        |
| `RequestTimedOut`           | The configured request duration expired.             |
| `AuthenticationFailed`      | Odoo returned HTTP `401`.                            |
| `PermissionDenied`          | Odoo returned HTTP `403`.                            |
| `UnexpectedStatus`          | Odoo returned another non-2xx status.                |
| `InvalidResponse`           | A response failed its schema.                        |
| `BridgeContractMissing`     | The module, model, or method is absent.              |
| `BridgeContractNotModel`    | The documented method lacks the `model` marker.      |
| `BridgeContractNotReadonly` | The documented method lacks the `readonly` marker.   |
| `CatalogFixtureEmpty`       | The contract fixture contains no item.               |

The error also has `operation`, `reason`, `code`, and a safe message. The
reason contains only an HTTP status, response kind, documentation part, or
option field when that data is needed. It does not contain the API key, body,
debug payload, or unrestricted URL. See
[error.ts:11](../../packages/odoo-bridge/src/error.ts:11).

Caller cancellation is not an `OdooBridgeError`. It rejects with the signal's
reason, or with a standard `AbortError` when the signal has no reason. A client
close is a separate `OdooBridgeClientClosedError`.

## What works well

The API has several strong properties.

1. The package has one domain operation for one bounded Odoo read. A consumer
   cannot accidentally request an unbounded catalog or a raw Odoo method.
2. Medusa receives decoded camel-case values, while the schema owns the exact
   wire encoding. The two edges do not maintain separate mapping code.
3. The Promise adapter creates one managed runtime. Repeated calls reuse one
   Effect service context and one resource scope.
4. The gateway interface is smaller than the client. Workflow tests need one
   `readCatalogBatch` fake and no Effect runtime.
5. The error union is closed. Consumers can act on stable tags instead of
   parsing messages or HTTP text.
6. Caller cancellation, request timeout, bridge failure, and client closure
   remain different outcomes.
7. The native Effect entry still exposes the v4 service, layer, HTTP service
   requirement, named operations, and typed failure channel.

These choices match the Effect v4 runtime boundary. The current Effect
integration example creates one `ManagedRuntime`, runs it from a host handler,
and disposes it during process shutdown. The current `ManagedRuntime` source
also states that layer construction is lazy, context is cached, and resources
are released by `dispose`.

## Pain points and friction

The following ranking measures effect on a normal Promise consumer and on
Medusa workflow code.

### P0: Fix before wider use

#### The factory defers local option errors

`createOdooBridge` is synchronous, but the Effect layer validates its options
when the managed runtime first runs. A bad route or empty key therefore does
not fail at construction. It fails at the first method call.

This follows the pinned `ManagedRuntime` behavior, which builds a layer lazily.
It is correct for an Effect layer, but surprising for a Promise factory named
`createOdooBridge`. A startup script can report the failure at a less useful
location, after it has already stored the client.

Recommendation: normalize local options in the Promise factory before runtime
creation. Throw a typed configuration error synchronously, or return a
factory result that makes construction failure explicit. Keep network checks
in `checkContract` and keep the native Effect layer lazy.

#### `optionalKey` accepts explicit `undefined` in the public type

The repository does not enable `exactOptionalPropertyTypes`. As a result,
TypeScript accepts both `{ limit: undefined }` and `{ cursor: undefined }` for
`CatalogBatchInput`. Effect v4's `Schema.optionalKey` means that the key can be
omitted. It does not mean that an own property with value `undefined` is valid.
The runtime rejects both objects before the request is sent.

Enabling `exactOptionalPropertyTypes` fixes the mismatch inside this
repository. It cannot control a downstream project's compiler settings. A
consumer without that option will still accept explicit `undefined` for an
optional property.

Recommendation: make the published type and runtime decoder agree under both
compiler settings. For this call input, accept explicit `undefined` with
`Schema.optional`, because normalization already treats it as omitted. Keep
stored cursor decoding strict in a separate decoder. Also enable
`exactOptionalPropertyTypes` in this package, so new mismatches fail during
development.

#### `readCatalogBatch` needs an `undefined` placeholder for signal-only calls

The input and call options occupy two optional positional arguments. A caller
that wants the default batch and a signal must write:

```ts
await bridge.readCatalogBatch(undefined, { signal });
```

`bridge.readCatalogBatch({ signal })` is treated as a catalog input and fails
schema validation. This is the most visible friction in the Promise API.

Recommendation: add an options-only overload for the exact `{ signal }` shape,
while keeping the explicit `(input, options)` form for cursor reads. The
implementation must distinguish an object with `signal` from a catalog input
before schema decoding. Do not merge `signal` into the wire input schema.

#### Error `code` does not narrow `reason`

`OdooBridgeError.code` is a getter with type
`OdooBridgeErrorReason["_tag"]`. The actual discriminated data lives under
`error.reason._tag`. TypeScript cannot correlate a getter's union value with a
separate nested union. This code therefore looks natural but does not narrow
the reason payload:

```ts
if (error instanceof OdooBridgeError) {
  switch (error.code) {
    case "InvalidResponse":
      error.reason.responseKind;
      // The current declaration still sees every reason shape here.
      break;
  }
}
```

Recommendation: export `OdooBridgeErrorCode`, an `isOdooBridgeError` guard,
and a generic `hasOdooBridgeErrorCode` guard. The guard can return an
intersection with `Extract<OdooBridgeErrorReason, { _tag: Code }>`.
Consumers can then use `hasOdooBridgeErrorCode(error, "InvalidResponse")` and
read `responseKind` safely. Keep `error.reason._tag` as the direct Effect
pattern-match path.

#### Semantic strings and numbers remain structural strings and numbers

The schemas check UUIDs, timestamps, decimal strings, positive IDs, and three-
letter currencies. Their decoded TypeScript fields still appear as ordinary
`string` or `number` values because a refinement check does not add a nominal
type. For example, `SourceRevision.changedAt` is a `string`, and
`CatalogVariant.integrationKey` is a `string`.

Effect v4 provides `Schema.brand` for a nominal output type and `Brand.check`
for a validating constructor. The schema can preserve the current runtime
checks and add brands:

```ts
const IntegrationKey = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("OdooIntegrationKey"),
);

type IntegrationKey = Schema.Schema.Type<typeof IntegrationKey>;
```

Recommendation: brand only domain values that cross module boundaries:
`OdooId`, `IntegrationKey`, `OdooDateTime`, `OdooDecimal`, and `CurrencyCode`.
Add small constructors or decoders for values loaded from Medusa storage, so
the stronger cursor type does not force unsafe assertions.

Do not brand every field. A brand that does not change a caller decision adds
type noise without useful protection.

#### Non-empty variants do not appear as non-empty to TypeScript

`CatalogItemSchema` uses `Schema.Array(CatalogVariantSchema).check(
Schema.isMinLength(1))`. The runtime rejects an item with no variants, but the
decoded type remains `ReadonlyArray<CatalogVariant>`. With
`noUncheckedIndexedAccess`, `item.variants[0]` remains optional even though the
Bridge Contract guarantees one variant.

Effect v4 provides `Schema.NonEmptyArray`, whose type is
`readonly [T, ...T[]]`. Recommendation: use it for `CatalogItem.variants` and
keep the runtime guarantee in the type. This removes repeated length checks in
Medusa import code.

### P1: Fix in the next API pass

#### The Promise declaration still exposes Effect through contract types

The root declaration imports `CatalogBatch`, `CatalogBatchInput`, and related
types from `contract.d.mts`. That file imports `Schema` and defines each type
with `Schema.Schema.Type`. A non-Effect consumer therefore resolves Effect
declarations while loading the root package, even though no method directly
returns an Effect.

Recommendation: publish a plain `public-types` declaration surface for the
root. Keep `/contract` as the Schema entry. The root can import plain decoded
interfaces from that module, while the Schema module uses those interfaces as
the reviewed domain shape. Do not manually map wire fields twice. Generate or
review the plain declarations as part of the package build so that a contract
change cannot silently drift from its Schema.

#### The root type names are too generic

The root exports `Options` and `CallOptions`. These names are easy to collide
with Medusa, Effect, and other clients. The Effect namespace already avoids
this problem through `OdooBridge.Options`.

Recommendation: use `OdooBridgeOptions` and `OdooBridgeCallOptions` in the
Promise entry. Keep `OdooBridgeClient`, `OdooBridgeGateway`, and
`OdooBridgeClientClosedError`.

#### `AsyncDisposable` creates a TypeScript library requirement

The generated client declaration extends the global `AsyncDisposable` type.
TypeScript declares that interface in `lib.esnext.disposable.d.ts`. A consumer
that uses an older `lib` set can fail while loading the declaration, even when
it only calls `close()` and never uses `await using`.

The repository targets Node 24 and uses `ESNext`, so the local package typecheck
has the required declaration. Medusa uses an `ES2022` library preset. The
generated declaration still exposes the global type to downstream projects.

Recommendation: document the `ESNext.Disposable` requirement for consumers
that use `await using`. Consider a local `OdooBridgeDisposable` interface in
the root declaration if compatibility with `ES2022` consumers matters. Keep
`close()` as the universal lifecycle method. Test both declaration modes with
the package's ESM and CJS consumers.

#### `instanceof` is not enough across ESM and CJS copies

The ESM build and CJS build contain separate class instances. A process that
loads both formats can receive an `OdooBridgeError` whose prototype does not
match the constructor imported from the other format. The `_tag`, `code`, and
`reason` fields still carry the error data, but `instanceof` can return false.

Recommendation: export a structural `isOdooBridgeError` guard. Use the guard
in the Medusa script and show it in the documentation. Keep `instanceof` as a
convenient same-module check.

Effect's own `HttpClientError` uses a stable internal `TypeId` property and an
`isHttpClientError` guard. The bridge can follow that pattern with a
package-specific `TypeId` and guard. This works across the ESM and CJS module
instances that the package build produces.

The native methods also report the full `OdooBridgeError` union. For example,
the catalog read type includes contract-check reasons that its implementation
cannot produce. This weakens exhaustive handling in Effect consumers and makes
the Promise documentation harder to read. Recommendation: define operation
reason aliases and narrow the native service methods to the reasons each
operation can produce. Keep one shared error class at the outer boundary.

#### Test injection is private and route validation is strict

The client captures `globalThis.fetch`, while its test-only `makeClient` takes
a fetch function. External Promise tests cannot use that helper through the
package root. They must stub global fetch, use a network interception tool, or
run against an allowlisted route.

Recommendation: first test the root with global fetch stubbing or request
interception. Add a public testing entry only if that pattern creates repeated
work. A public generic transport would expose implementation detail and make
the boundary less safe. A testing-only fetch factory is a smaller extension if
one is needed.

#### Schema issue details are discarded

`InvalidResponse` reports only `responseKind`, and
`InvalidCatalogBatchInput` reports no field or path. The internal schema issue
contains useful field paths, but the mapping at the HTTP and catalog edges
discards them. Recommendation: expose a small safe `path` or `field` value for
diagnostics. Do not expose the raw response body, API key, or full Effect
ParseError.

### P2: Improve discoverability

#### The root does not export schema values or encoded types

The root exports decoded contract types and constants. Schema values and the
wire codecs live under `/contract`. A Promise consumer that stores a cursor and
needs to decode it after reading JSON must discover that subpath.

Recommendation: keep schemas under `/contract`, but export explicit names such
as `CatalogBatchEncoded`, `CatalogBatchRequestEncoded`, and
`SourceRevisionEncoded`. Add one short README example for decoding persisted
cursor data. Do not re-export Effect schemas from the Promise root.

#### The timeout contract needs a named default

The default is implemented as the string `"20 seconds"` inside the Effect
service. The Promise API presents `requestTimeoutMs`, but it exports no default
constant. Consumers that want to align their operation deadline with the
request timeout must repeat `20_000`.

Recommendation: export `DEFAULT_REQUEST_TIMEOUT_MS = 20_000` from the Promise
entry. Keep the numeric millisecond unit. It is clearer than exposing Effect's
wide `Duration.Input` union to Promise consumers.

#### Per-call deadlines are deliberately signal-based

`CallOptions` has no `timeoutMs`. A caller uses the platform API:
`AbortSignal.timeout(15_000)`. This keeps one timer model and preserves the
difference between a caller deadline and the bridge's request timeout.

This is a good boundary for Node 24 and modern browsers. It creates friction
for older hosts and for code that expects every client to accept `timeoutMs`.
Do not add a second hand-written timer without a concrete Medusa use case. If a
per-call option becomes necessary, define one timeout policy and map only that
timeout to `RequestTimedOut`.

## Type safety and generics

### Keep the domain API closed and concrete

Do not add a generic `readCatalogBatch<T>()`, a generic `OdooBridgeGateway<T>`,
or a generic `request<T>()`. A caller-supplied type parameter cannot make an
untrusted JSON response match that type. It would remove the strongest safety
property of this package: the response Schema remains the source of truth.

The private `executeJson<S>` helper already uses a generic schema parameter at
[http-client.ts:40](../../packages/odoo-bridge/src/internal/http-client.ts:40).
That is the correct place for a generic. The generic binds the decoded result
to the schema that performs the runtime check.

If a later Bridge Contract adds another method, add a specific request schema,
response schema, decoded type, and service method. Do not turn the package into
an open RPC client.

### Add explicit encoded and decoded type aliases

The `/contract` entry can expose both sides of each codec:

```ts
export type CatalogBatch = Schema.Schema.Type<typeof CatalogBatchSchema>;
export type CatalogBatchEncoded = Schema.Schema.Encoded<typeof CatalogBatchSchema>;
```

The Promise methods return `CatalogBatch`. Encoded aliases help tests and
contract tooling build exact Odoo fixtures without repeating snake-case object
types. They do not weaken the Promise API because the raw wire value remains
private to the client.

### Add nominal domain types with small construction paths

The strongest type gaps are the values that look like ordinary strings:

| Value                     | Current decoded type | Better type              |
| ------------------------- | -------------------- | ------------------------ |
| Source Revision timestamp | `string`             | branded `OdooDateTime`   |
| Product or Variant ID     | `number`             | branded `OdooId`         |
| Integration Key           | `string`             | branded `IntegrationKey` |
| Price                     | `string`             | branded `OdooDecimal`    |
| Currency                  | `string`             | branded `CurrencyCode`   |

Keep `name`, `description`, `barcode`, and `internalReference` structural. They
do not identify one domain type from another.

Use `Schema.brand` after an existing check. Use `Brand.check` when a caller
needs a constructor, `option`, `result`, or type guard for values loaded from a
database. Effect documents that `Schema.brand` narrows the output type without
adding a second runtime check, while `Brand.check` creates a validating
constructor.

### Correlate error codes with reason payloads

The current reason union is already the right data model. Add type utilities:

```ts
export type OdooBridgeErrorCode = OdooBridgeErrorReason["_tag"];

export type OdooBridgeReason<Code extends OdooBridgeErrorCode> = Extract<
  OdooBridgeErrorReason,
  { readonly _tag: Code }
>;
```

Then add a guard with a correlated result:

```ts
function hasOdooBridgeErrorCode<Code extends OdooBridgeErrorCode>(
  error: unknown,
  code: Code,
): error is OdooBridgeError & {
  readonly code: Code;
  readonly reason: OdooBridgeReason<Code>;
};
```

This gives Promise consumers safe narrowing without changing the native Effect
error channel or the `Schema.TaggedError` class.

### Narrow Effect errors by operation

Every native method currently returns the full `OdooBridgeError` union. The
type therefore says that `readCatalogBatch` can fail with contract-document
errors. It also says that layer construction can fail with a response-decoding
error. Those outcomes cannot occur in those operations.

Use the operation as a type index:

```ts
interface OdooBridgeErrorReasonByOperation {
  readonly "bridge.configure": BridgeConfigurationErrorReason;
  readonly "catalog.readBatch": CatalogReadErrorReason;
  readonly "contract.check": ContractCheckErrorReason;
}

export type OdooBridgeErrorFor<Operation extends OdooBridgeOperation> = OdooBridgeError & {
  readonly operation: Operation;
  readonly reason: OdooBridgeErrorReasonByOperation[Operation];
};
```

Make `makeOdooBridgeError` generic in its operation and reason. Then give
`make`, `layer`, `readCatalogBatch`, and `checkContract` their exact error
aliases. This generic ties two facts that already belong together. It makes
Effect's error channel useful without adding caller-selected data generics.

The Promise methods still return `Promise<A>`. TypeScript's standard
`Promise<T>` has no failure type parameter, so a second Promise generic cannot
carry this information. Promise consumers use the exported guards. Effect
consumers get the operation-specific error type in the `E` channel.

Do not add a generic RPC or client HKT to correlate operation names with
responses. The Promise type `Promise<T>` has no rejection type parameter, so a
generic Promise client cannot make rejected error types visible to TypeScript.
Operation-indexed error aliases help the native Effect API and error guards,
but they do not replace runtime narrowing for Promise callers.

The public names also need TSDoc. The package has no root README or exported
TSDoc that explains the two base URLs, the `20_000` millisecond default, the
contract-check cost, the cursor ownership rule, or the close behavior. In
addition, `docs/architecture.md` still shows the removed `/promise` entry, and
older bridge research describes superseded retries and session APIs. Update or
archive those documents before using them as onboarding material.

## Recommended next shape

The next Promise API pass can keep the current ownership model and change only
the high-value edges:

```ts
export interface OdooBridgeOptions {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly database: string;
  readonly requestTimeoutMs?: number;
}

export interface OdooBridgeCallOptions {
  readonly signal?: AbortSignal;
}

export interface OdooBridgeGateway {
  readonly readCatalogBatch: {
    (options?: OdooBridgeCallOptions): Promise<CatalogBatch>;
    (input: CatalogBatchInput, options?: OdooBridgeCallOptions): Promise<CatalogBatch>;
  };
}

export interface OdooBridgeClient extends OdooBridgeGateway, AsyncDisposable {
  readonly checkContract: (options?: OdooBridgeCallOptions) => Promise<BridgeContractCheck>;
  readonly close: () => Promise<void>;
}
```

The overload removes the `undefined` placeholder for the common default read.
The implementation must preserve the explicit two-argument form and reject
objects that mix input fields with call options.

Pair this shape with:

- synchronous validation of local factory options;
- `OdooBridgeErrorCode` and correlated narrowing helpers;
- nominal types for IDs, keys, timestamps, decimals, and currencies;
- encoded type aliases under `/contract`;
- `DEFAULT_REQUEST_TIMEOUT_MS`;
- a declaration test for consumers with and without `ESNext.Disposable`;
- a structural error guard for mixed ESM and CJS hosts.

This set improves everyday Promise use without adding a generic transport or a
second lifecycle model. The native Effect API remains a concrete
`Context.Service` with one `ManagedRuntime` at the Promise boundary.
