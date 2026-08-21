# Odoo bridge interface and technology design

**Date checked:** 2026-08-20  
**Status:** Implemented. Design C remains a deferred evolution path.

## Decision summary

Use an Effect-first core with a verified read-only capability, then expose a
small Promise/CJS edge for Medusa. Keep the transport behind an injected
Effect service. The core uses Effect Schema and its JSON codec derivation.

The recommended shape combines the immediate usability of Design A with the
boundary discipline of Design C:

```text
                    OdooBridge (Effect service)
                           │
                       verify()
                           │
                    OdooCatalogSession
                      ┌────┴─────┐
                      │          │
                 readAllCatalog  pages()
                      │          │
                   Effect Stream  AsyncIterable
                           │
                    injected transport
                     ┌─────┴─────┐
                     │           │
                  fetch       Effect adapter
```

The root package exposes the Effect service. The `/promise` entry keeps Effect
types out of the Medusa CommonJS caller. The package does not expose Ky, ofetch,
ts-rest, or a generated client.

The implementation uses `effect@4.0.0-rc.109`, the version already pinned by
the repository. It uses native `fetch` behind an `OdooTransport` layer rather
than the unstable Effect HTTP client. This isolates the unstable surface and
keeps request injection simple.

## Constraints from the repository and Odoo

`@mze-store/odoo-bridge` now has an Effect service, Effect Schema contracts,
an injected `fetch`-compatible request function, and explicit ESM and CJS
exports. Medusa imports `/promise` from a CJS TypeScript island. The bridge is
a read-only catalog boundary. It must not become a generic Odoo RPC client.

Odoo 19 JSON-2 has three properties that shape the interface:

- Requests are `POST /json/2/<model>/<method>` with named JSON arguments and a
  bearer API key. The official protocol is documented in the
  [Odoo 19 External JSON-2 API documentation](https://www.odoo.com/documentation/19.0/developer/reference/external_api.html).
- The bridge method is `@api.model`, so the request contains named `limit` and
  `cursor` members and omits `ids`.
- The method is marked `@api.readonly`, and `/doc-bearer` exposes that marker.
  The marker selects a read-only cursor. It does not replace ACLs, group checks,
  or a review of side effects. The full protocol and source findings are in
  [the Odoo primary-source note](./odoo-bridge-primary-sources.md).

Odoo's dynamic documentation proves that the model and method exist and that
the method is marked read-only. It does not describe the full
`mze.odoo.catalog.v1` response schema. Keep that response contract in the
package's hand-authored schemas.

Each JSON-2 request has its own SQL transaction. A future operation that needs
atomic work belongs in one Odoo method. The TypeScript client must not compose
dependent calls and treat them as one transaction.

## Current package assessment

The current implementation already has useful safety properties:

- a private-host allowlist rejects the public Odoo route;
- bearer and database headers are fixed inside the client;
- documentation is read before the contract fixture;
- the method, model, and contract version are validated;
- the response is decoded with Effect Schema's JSON codec;
- the client exposes no arbitrary model or method call;
- the package emits both ESM and CJS builds.

The DX problems are concentrated in the public surface:

- callers can invoke documentation and catalog methods separately, so the
  rollout gate is easy to bypass;
- `readCatalogBatch` has no signal or timeout parameter;
- errors omit a stable operation name and pagination failures have no code;
- cursor pagination is left to each caller;
- the package has a Promise edge that keeps Effect concepts out of Medusa;
- adding a second transport or an Effect adapter requires a clean seam;
- the package has no explicit telemetry extension point.

The next design reduces caller decisions. It keeps the Odoo route,
authentication, response parsing, and failure redaction inside the package.

## Design A: verified capability with a minimal Promise API

### Public interface

```ts
type OdooCatalogReadOptions = {
  readonly limit?: number;
  readonly cursor?: OdooCatalogCursor | null;
  readonly maxPages?: number;
  readonly signal?: AbortSignal;
};

type VerifiedOdooBridge = {
  readonly contract: OdooReadOnlyContract;
  readonly readCatalogBatch: (
    input?: OdooCatalogBatchRequest,
    options?: { readonly signal?: AbortSignal },
  ) => Promise<OdooCatalogBatch>;
  readonly pages: (options?: OdooCatalogReadOptions) => AsyncIterable<OdooCatalogBatch>;
};

class OdooBridgeClient {
  constructor(config: OdooBridgeConfig, request?: OdooRequest);
  checkReadOnlyContract(): Promise<VerifiedOdooBridge>;
}
```

Usage stays direct:

```ts
const client = new OdooBridgeClient(config);
const bridge = await client.checkReadOnlyContract();

for await (const page of bridge.pages({ limit: 50, maxPages: 100 })) {
  await importBatch(page.items);
}
```

`checkReadOnlyContract` performs the documentation index request, model
documentation request, method and `readonly` checks, and one bounded fixture
request. The returned capability is the only object that can read catalog
data. The first fixture can be retained as part of the capability so the gate
does not discard a successful request.

The iterator reads one page at a time. It stops at `next_cursor: null`, detects
repeated or non-advancing cursors, and enforces `maxPages`. It does not build a
full catalog in memory.

### What it hides

- Odoo paths, model, and method names;
- bearer and database headers;
- private endpoint validation;
- Zod decoding;
- documentation gate order;
- cursor progression and cycle detection;
- response bodies and credentials in errors.

### Trade-offs

This is the lowest learning-cost design. It fits the current Medusa caller and
the package's dual-module build. The interface is intentionally specialized;
each future read method receives its own contract and domain method. Callers
cannot use this client for an unreviewed write.

The class still combines the transport and contract layers internally. That is
adequate while `fetch` is the only transport. A second runtime adapter justifies
extracting the seam described in Design C.

## Design B: Effect-first service with a Promise edge

### Public interface

```ts
interface OdooBridgeService {
  readonly checkReadOnlyContract: () => Effect.Effect<OdooReadOnlyContract, OdooBridgeError>;
  readonly readCatalogBatch: (
    input?: OdooCatalogBatchRequest,
  ) => Effect.Effect<OdooCatalogBatch, OdooBridgeError>;
  readonly readCatalog: (
    options?: OdooCatalogReadOptions,
  ) => Stream.Stream<OdooCatalogItem, OdooBridgeError>;
}

class OdooBridge extends Context.Service<OdooBridge, OdooBridgeService>()(
  "@mze-store/OdooBridge",
) {}
```

The layer owns configuration, redacted credentials, HTTP transport, bounded
retry policy, contract-check memoization, and cursor stream termination. The
application provides the layer. It owns the environment source, which keeps
`process.env` and the repository's `varlock` boundary out of the package.

An Effect consumer can write:

```ts
const program = Effect.gen(function* () {
  const bridge = yield* OdooBridge;
  yield* bridge.checkReadOnlyContract();
  return yield* bridge.readCatalog({ limit: 50 }).pipe(Stream.runCollect);
});
```

The Promise edge can use `ManagedRuntime` or a small adapter. It needs an
explicit lifecycle if the runtime owns resources.

### Technology fit

The repository pins `effect@4.0.0-rc.109`. Effect v4 provides
`Context.Service`, `Layer`, typed schemas, schedules, streams, and tracing.
The official migration guide still describes v4 as beta, and the HTTP client
is under `effect/unstable/http`; see the [Effect v4 migration guide](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md)
and the [Effect HTTP client source](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/unstable/http/HttpClient.ts).
The pinned installation uses `Schema.TaggedError`; the adapter must follow the
installed API and keep unstable imports in one module.

Effect is a good fit for a persistent ERP workflow that combines Odoo with
other services. It brings little value to a one-shot contract check with one
read operation. It also changes every caller's programming model and adds a
runtime dependency at the CJS boundary.

`@api.readonly` does not make every POST retry-safe by itself. An Effect layer
can provide bounded transient retries after the Odoo method's side effects are
verified. The retry policy must exclude unknown operations and unbounded loops.

### Trade-offs

This design gives the strongest composition, cancellation, retry, stream, and
test-layer support. It has the highest setup and learning cost. It also binds
the package to the Effect v4 release-candidate API and its unstable HTTP
module. A Promise adapter reduces the CJS impact but adds a second public
programming model.

Use this design when the bridge becomes a workflow service. Do not make it the
first implementation of the current catalog boundary.

## Design C: split contract core, transport adapter, optional Effect facade

### Architecture

```text
contract schemas and domain operations
                    │
                    ▼
             transport-neutral core
                 ┌──────┴──────┐
                 ▼             ▼
             fetch adapter  Effect adapter
```

The core owns the Odoo constants, request and response schemas, private route
rules, read-only gate, pagination rules, and safe error values. It knows
nothing about `fetch`, Node, credentials, or Effect.

The transport boundary can be as small as:

```ts
interface OdooTransport {
  request(input: {
    readonly operation: string;
    readonly method: "GET" | "POST";
    readonly path: string;
    readonly body?: unknown;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly status: number; readonly body: unknown }>;
}
```

The default fetch adapter owns URL construction, authentication, status
classification, JSON parsing, and redaction. Contract tests can use a fake
transport without constructing `Request` or `Response` objects.

The public domain surface can group the methods without exposing generic RPC:

```ts
interface OdooBridge {
  readonly contract: {
    readonly check: () => Promise<OdooReadOnlyContract>;
  };
  readonly catalog: {
    readonly readBatch: (
      input?: OdooCatalogBatchRequest,
      options?: { readonly signal?: AbortSignal },
    ) => Promise<OdooCatalogBatch>;
    readonly pages: (options?: OdooCatalogReadOptions) => AsyncIterable<OdooCatalogBatch>;
  };
}
```

The implemented root entry point exposes the Effect service. The `/promise`
entry uses the same service internally and keeps Effect types out of the
Medusa caller.

### Standard Schema and generated artifacts

[Standard Schema](https://standardschema.dev/) defines a common validation
interface across Zod, Valibot, ArkType, and Effect. It remains a possible seam
for Design C if another validator becomes a real consumer. The package does
not add it while Effect Schema is the canonical contract.

Effect Schema also provides JSON Schema derivation. The package can later
publish a versioned artifact with `Schema.toJsonSchemaDocument` after the
contract has more operations or external consumers.

Generate a versioned JSON Schema or OpenAPI snapshot from the canonical bridge
schemas only after the contract has multiple operations or external consumers.
Use the snapshot for review, drift checks, and documentation. Do not generate
the client from Odoo's dynamic `/doc-bearer` payload.

### Trade-offs

This design remains the cleanest future split when a second transport or a
validator-independent contract is needed. The current implementation already
has its transport seam as an Effect service, so Design C can split the pure
operation registry without changing the Promise edge.

## Comparison

| Criterion                        | Design A: minimal Promise | Design B: Effect-first | Design C: split boundary            |
| -------------------------------- | ------------------------- | ---------------------- | ----------------------------------- |
| First-use DX                     | Best                      | Lowest                 | High                                |
| Fit for current Medusa CJS       | Best                      | Requires Promise edge  | Best                                |
| Read-only misuse resistance      | High                      | High                   | High                                |
| Contract-test isolation          | Medium                    | High                   | Best                                |
| Pagination and retry composition | Caller/helper based       | Best                   | Promise helper plus optional Effect |
| Runtime dependency cost          | Lowest                    | Highest                | Low in core                         |
| Future transport adapters        | Medium                    | High                   | Best                                |
| Effect adoption path             | Wrapper later             | Immediate              | Optional subpath                    |
| Current recommendation           | Replaced by Effect core   | Implemented            | Future typed-query seam             |

Design B is the current implementation. Design A remains the simplest mental
model for Promise callers. Design C is recorded for a future split of codecs,
operation descriptions, and transport adapters.

## Implementation status

The recommended implementation is complete:

1. `OdooBridge` is an Effect `Context.Service` with a verified, cached
   read-only gate.
2. `readCatalogPages` uses a lazy Effect `Stream` with cursor-cycle, page, and
   item limits. `readAllCatalog` covers the common one-call path.
3. `OdooBridgeError` is a schema-backed tagged error with operation, status,
   retry, timeout, cancellation, and pagination data. It never carries a key,
   header, or response body.
4. Native `fetch` is injected through `OdooTransport`. Requests carry the
   caller's `AbortSignal`, per-request timeout, and bounded transient retries.
5. `Schema.toCodecJson` drives request encoding and response decoding.
6. `/promise` provides the Medusa Promise/CJS edge. Packed ESM and CJS smoke
   tests cover both entries.

Design C is deferred. Its next step is an internal typed operation registry
that can serve both the Effect service and another transport without exposing
generic Odoo RPC.

## Technologies considered and deferred

- **Effect:** selected for the core because typed failures, cancellation,
  streams, retries, layers, and test substitution match this workflow.
- **Standard Schema:** reserve as an extension seam; defer a direct dependency.
- **OpenAPI code generation:** useful after the contract grows; Odoo's dynamic
  documentation is not a complete response schema.
- **ts-rest:** low fit because MZE does not own the Odoo server contract.
- **Ky and ofetch:** duplicate a small native transport and do not provide the
  required read-only domain boundary. Ky's default retry model also excludes
  the POST-heavy Odoo protocol.
- **Undici:** Node 24 already provides the needed fetch path. Add it only for a
  concrete dispatcher, proxy, or TLS-agent need.
- **OpenTelemetry SDK:** application-owned. The bridge can provide hooks or an
  API-only integration.
- **MSW or a global HTTP mock:** unnecessary for the core tests while the
  injected request function and transport seam can record calls directly.

## Exit criteria for implementation

The design is ready to implement when these checks are agreed:

- no public generic Odoo model/method executor;
- catalog reads require a successful documentation and read-only gate;
- the package supports cancellation and bounded pagination;
- all errors have safe, stable codes and operation names;
- packed ESM and CJS imports both work under the pinned Node version;
- the root package owns the Effect runtime dependency;
- the Promise edge keeps Effect types out of Medusa;
- Odoo response schemas remain owned by the MZE bridge contract;
- tests cover authentication headers, gate order, malformed responses,
  pagination cycles, redaction, and private endpoint enforcement.
