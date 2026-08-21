# Effect v4 interface playbook

Read and apply this playbook before you design, change, or review an interface
that uses Effect. This includes private interfaces. It covers `Effect`,
`Context`, `Layer`, `Schema`, `Result`, `Data`, `Stream`, `Schedule`, `Cache`,
the Effect HTTP client, and runtime adapters.

Also apply the general
[`api-design.md`](./api-design.md) standard. The general standard owns caller
experience and module depth. This playbook owns Effect primitive selection,
module structure, errors, resources, runtime adapters, and Effect tests.

The repository pins `effect@4.0.0-rc.109`. Recheck this playbook after each
Effect upgrade.

## Source order

Use sources in this order:

1. The installed source and declarations under `node_modules/effect/src`.
2. Existing repository modules and tests that use the same pinned version.
3. Official Effect documentation for the exact pinned version.
4. Current upstream Effect source for design direction only.
5. Skills, articles, examples, and memory.

The installed source wins when guidance conflicts. For this pin, the service
primitive is `Context.Service` and the schema-backed error primitive is
`Schema.TaggedError`. Advice that names `Effect.Service` or
`Schema.TaggedErrorClass` does not apply to this version.

Before you use a version-sensitive symbol, find it in installed source or its
generated declarations. Never import an internal Effect implementation path.

## Required design pass

Complete the general design process first. Then record an Effect primitive
inventory for the interface.

| Need                                       | First primitive to inspect                            |
| ------------------------------------------ | ----------------------------------------------------- |
| A required contextual capability           | `Context.Service`                                     |
| An ambient value with a safe default       | `Context.Reference`                                   |
| Dependency construction and ownership      | `Layer`                                               |
| Untrusted input or a wire contract         | `Schema`                                              |
| A synchronous success-or-failure value     | `Result`                                              |
| A closed set of immutable states           | `Data.TaggedEnum`                                     |
| Shared mutable state in Effect             | `Ref` or `SynchronizedRef`                            |
| A resource with cleanup                    | `Scope`, `Effect.acquireRelease`, or a scoped `Layer` |
| A reusable runtime for a non-Effect caller | `ManagedRuntime`                                      |
| A lazy sequence with backpressure          | `Stream`                                              |
| Point-to-point work delivery               | `Queue`                                               |
| Broadcast delivery                         | `PubSub`                                              |
| A current value and its changes            | `SubscriptionRef`                                     |
| One result shared by fibers                | `Deferred`                                            |
| Retry or repetition over time              | `Schedule` with `Effect.retry` or `Effect.repeat`     |
| Keyed memoization                          | `Cache`                                               |
| Application-owned configuration loading    | `Config`                                              |
| HTTP request construction and decoding     | `effect/unstable/http`                                |
| A secret held in memory                    | `Redacted`                                            |

This table is a routing aid. Do not add a primitive until a caller fact or an
implementation invariant needs it.

## Module structure

Keep domain data, errors, the service, internal operations, and runtime
adapters in separate modules. A typical package has this shape:

```text
src/
  contract.ts             schemas, wire constants, encoded and decoded types
  error.ts                direct tagged errors and exact operation unions
  odoo-bridge.ts          native service namespace
  client.ts               non-Effect runtime adapter
  effect.ts               Effect caller entry
  index.ts                non-Effect caller entry
  internal/               transport and workflow details
```

The split follows caller vocabularies. It does not create a second business
implementation. Both public entries call the same native operations.

### Native service module

Use this shape for one cohesive contextual capability:

```ts
export type Options = InternalOptions;

export interface Interface {
  readonly checkContract: () => Effect.Effect<BridgeContractCheck, CheckContractError>;
  readonly readCatalogBatch: (
    input?: CatalogBatchInput,
  ) => Effect.Effect<CatalogBatch, ReadCatalogBatchError>;
}

export class Service extends Context.Service<Service, Interface>()(
  "@mze-store/odoo-bridge/OdooBridge",
) {}

export const make = Effect.fn("OdooBridge.make")(function* (options: Options) {
  const settings = yield* Effect.fromResult(decodeSettings(options));
  const client = configureHttpClient(yield* HttpClient.HttpClient, settings);

  const readCatalogBatch = Effect.fn("OdooBridge.readCatalogBatch")((input?: CatalogBatchInput) =>
    readCatalogBatchRequest(client, settings, input),
  );

  const checkContract = Effect.fn("OdooBridge.checkContract")(() =>
    checkContractRequest(client, settings),
  );

  return Service.of({ checkContract, readCatalogBatch });
});

export const layer = (
  options: Options,
): Layer.Layer<Service, ConfigurationError, HttpClient.HttpClient> =>
  Layer.effect(Service, make(options));

export const checkContract: Effect.Effect<BridgeContractCheck, CheckContractError, Service> =
  Service.use((bridge) => bridge.checkContract());

export const readCatalogBatch = (
  input?: CatalogBatchInput,
): Effect.Effect<CatalogBatch, ReadCatalogBatchError, Service> =>
  Service.use((bridge) => bridge.readCatalogBatch(input));

export * as OdooBridge from "./odoo-bridge";
```

Each member has one job:

- `Interface` states the capability without its construction.
- `Service` is the context key and service value constructor.
- `make` validates options, reads dependencies, and builds the service.
- `layer` tells an application how to construct and own the service.
- accessors make programs read as domain workflows instead of service plumbing.
- the namespace export gives callers one stable module name.

Do not create this full shape for a pure function. A service and layer must hide
real dependency wiring, policy, or resource ownership.

### Namespace exports

Effect package entries often use this pattern:

```ts
export * as HttpClient from "./HttpClient.ts";
```

This repository also lets a cohesive leaf module establish its own namespace:

```ts
export * as OdooBridge from "./odoo-bridge";
```

The second form is a repository convention. Effect's package entries provide
the precedent for the namespace surface, but Effect does not require a leaf to
self-export. Keep the leaf self-export when it is the tested canonical
interface. Do not replace it with a hand-built object that can drift from the
module exports.

Use a flat export for cohesive data and codec members that callers combine
directly. Use a namespace for a service whose members form one capability. For
example, the Effect entry can export contract schemas flat and relay only the
service namespace:

```ts
export * from "./contract";
export { OdooBridge } from "./odoo-bridge";
```

Do not flatten `Service`, `make`, `layer`, and accessors into a package root
that serves another audience.

### Service and reference choice

Use `Context.Service` for a required capability. Use `Context.Reference` only
when every caller has one safe default. A phase label that defaults to absent
can be a reference. Credentials, database access, authority, and required
connections cannot.

Use `Effect.serviceOption` only when the service is truly optional at the point
of use. It is useful when a narrow workflow can provide a renderer for one call
while other calls run without it. It is not a way to hide a missing required
dependency.

### Layer choice

Choose the narrowest constructor that states the real work:

| Construction fact                          | Layer primitive       |
| ------------------------------------------ | --------------------- |
| The service value already exists           | `Layer.succeed`       |
| Synchronous construction cannot fail       | `Layer.sync`          |
| Construction is an Effect                  | `Layer.effect`        |
| Construction yields a full context         | `Layer.effectContext` |
| Startup work exports no service            | `Layer.effectDiscard` |
| An Effect chooses or constructs a Layer    | `Layer.unwrap`        |
| Independent sibling layers combine         | `Layer.mergeAll`      |
| One layer needs another layer              | `Layer.provide`       |
| Consumers still need the provided services | `Layer.provideMerge`  |

Keep dependency requirements visible in the `R` type until a layer provides
them. Do not use `Layer.orDie` to erase a real configuration or startup error.
It is valid only after an earlier boundary has proved that the failure cannot
occur there.

## Native operations

The native operation type is `Effect.Effect<A, E, R>`:

- `A` is the success value.
- `E` is the exact expected-error union.
- `R` is the required service context.

Keep all three channels meaningful. Do not hide a dependency in a global, put
an expected error in a defect, or return `Effect<Result<A, E>, never, R>` from
the native core.

Use `Effect.gen` for sequential workflows. Use `Effect.fn("Module.operation")`
for important functions. It preserves inference and adds a stable operation
name for Effect diagnostics and tracing.

Use a synchronous `Result` for pure parsing or option normalization. Lift it
once when the Effect service is built:

```ts
const loadSettings = Effect.gen(function* () {
  const settings = yield* Effect.fromResult(decodeSettings(options));
  return settings;
});
```

Do not turn a whole asynchronous workflow into nested `Result` values. Keep
the workflow in Effect and convert only at a caller boundary that needs a
value-level outcome.

## Errors and control flow

### Direct tagged errors

Use direct `Schema.TaggedError` classes for expected errors that form part of a
package contract:

```ts
export class PermissionDenied extends Schema.TaggedError<PermissionDenied>()("PermissionDenied", {
  status: Schema.Literal(403),
}) {}

export type ReadCatalogBatchError =
  InvalidCatalogBatchInput | InvalidCatalogBatchResponse | RequestError;
```

The direct `_tag` lets callers use `Effect.catchTag` and `Effect.catchTags`.
Define each operation's error union beside the errors. Do not make every
operation return one package-wide union.

When errors can cross ESM and CommonJS package instances, export a structural
guard. Build one Schema union and derive the guard with `Schema.is`:

```ts
const OdooBridgeErrorSchema = Schema.Union([
  InvalidCatalogBatchInput,
  InvalidCatalogBatchResponse,
  PermissionDenied,
]);

export const isOdooBridgeError = Schema.is(OdooBridgeErrorSchema);
```

Do not make `instanceof` the only public guard. Two valid module instances can
have different constructor identities.

Effect errors are yieldable. Return a domain error directly from a generator:

```ts
const requireModel = Effect.gen(function* () {
  if (documentedModel === undefined) {
    return yield* new BridgeContractMissing({ part: "model" });
  }
  return documentedModel;
});
```

Do not add a helper that only forwards fields to `new ErrorType(fields)`. A
helper earns its place only when it proves an invariant, normalizes data, or
selects policy.

Use `Data.TaggedError` for a private tagged error that needs no schema. Use
`Schema.TaggedError` when a public error needs schema support or can cross a
package boundary.

### No JavaScript `try`/`catch` for expected failures

Use the primitive that matches the source of failure:

| Failure source                              | Primitive                                      |
| ------------------------------------------- | ---------------------------------------------- |
| A synchronous API can throw                 | `Effect.try`                                   |
| A Promise API can reject                    | `Effect.tryPromise`                            |
| An Effect dependency has another error type | `Effect.mapError`                              |
| One known tag needs recovery                | `Effect.catchTag`                              |
| Several known tags need separate recovery   | `Effect.catchTags`                             |
| A typed failure must become a value         | `Effect.result`                                |
| A failed invariant must become a defect     | `Effect.orDie`, after the invariant is proved  |
| A JavaScript boundary must reject a defect  | inspect `Exit`, then `Cause.squash` the defect |

Do not wrap an Effect program in JavaScript `try`/`catch`. That loses the
typed error channel and does not model interruption or finalization. Wrap only
the actual throwing call with `Effect.try` or `Effect.tryPromise`.

Do not use `catchAll` followed by one generic remap when tags require different
recovery. Do not use `Cause.squash` for expected errors. Keep defects and
interruption distinct until the final runtime boundary.

Use `Effect.ignore` only for an explicitly best-effort action whose failure
cannot change the owning operation, such as a cosmetic renderer update. State
that policy close to the call.

## Schema and trusted data

Decode `unknown` at the first trust boundary:

- use `Schema.decodeUnknownEffect` inside an Effect workflow;
- use `Schema.decodeUnknownResult` inside pure option normalization;
- use request schemas to encode HTTP bodies;
- use response schemas to decode HTTP bodies;
- use `Schema.encodeKeys` when domain names differ from wire names;
- derive public types with `Schema.Schema.Type<typeof SchemaValue>`;
- export encoded aliases too when callers work with the wire form.

Keep optionality exact. `Schema.optionalKey` means the property key can be
absent. `Schema.NullOr` means the value can be `null`. Do not use one to stand
in for the other. Apply defaults after decoding so the internal settings type
can make required fields non-optional.

Create a `Redacted` value at the first trusted point. Do not keep a secret as a
plain string through internal construction. Never put request headers, response
bodies, or secret-bearing causes in public errors.

An internal generic can bind a decoded output to the schema that proves it:

```ts
export function executeJson<
  S extends Schema.Constraint & { readonly DecodingServices: never },
  E extends InvalidResponseError,
>(responseSchema: S, onInvalidResponse: () => E): Effect.Effect<S["Type"], E | RequestError> {
  // ...
}
```

This generic preserves a real schema-to-output relationship. Never expose a
caller-selected generic that claims the shape of an untrusted response.

### Pure option decoding

Use `Result.gen` when local option parsing has several expected failures. Keep
this step synchronous so a factory can reject invalid local input before it
allocates a runtime or sends a request.

```ts
export function decodeSettings(options: Options): Result.Result<Settings, ConfigurationError> {
  return Result.gen(function* () {
    const url = yield* Schema.decodeUnknownResult(Schema.URLFromString)(options.baseUrl).pipe(
      Result.mapError(() => new PrivateOdooRouteRequired({})),
    );

    const requestTimeout = yield* Duration.fromInput(options.requestTimeout ?? "20 seconds").pipe(
      Result.fromOption(() => new InvalidRequestTimeout({})),
    );

    return {
      ...options,
      baseUrl: url.origin,
      requestTimeout,
    };
  });
}
```

Use `Result.mapError` when one parser error becomes one domain error. Use
`Result.fromOption` when absence means a named configuration error. Apply each
default and normalization once. Return an internal settings type whose
required fields are no longer optional.

Use `Option` when absence is a domain value that must compose. Use an optional
property for a normal caller option. Do not use either form to hide an invalid
required value.

Use Schema checks and literals to carry proved facts into the decoded type.
Examples include a literal contract version, a positive integer, and an array
that the decoder proves is non-empty. Do not validate a stronger fact and then
publish a weaker type when Schema can preserve the guarantee.

## Tagged state instead of boolean clusters

Use `Data.TaggedEnum` when a closed state set carries small, immutable data:

```ts
type ClientState = Data.TaggedEnum<{
  Closed: {};
  Closing: { readonly completion: Promise<void> };
  Open: {};
}>;

const ClientState = Data.taggedEnum<ClientState>();
let state: ClientState = ClientState.Open();
```

Use `$is` for one guard:

```ts
if (!ClientState.$is("Open")(state)) {
  return Promise.resolve(Result.fail(new OdooBridgeClientClosed({})));
}
```

Use `$match` when every state needs behavior:

```ts
const close = (): Promise<void> =>
  ClientState.$match(state, {
    Closed: () => Promise.resolve(),
    Closing: ({ completion }) => completion,
    Open: () => {
      const completion = runtime.dispose().then(() => {
        state = ClientState.Closed();
      });
      state = ClientState.Closing({ completion });
      return completion;
    },
  });
```

This model makes invalid combinations impossible. The `Closing` state stores
the one shared completion, so every concurrent `close` call receives the same
Promise. It replaces `closed`, `closing`, `closePromise`, and related boolean
branches.

A local variable is acceptable at a single synchronous JavaScript adapter
edge. Use `Ref` when Effect fibers share mutable state. Use `SynchronizedRef`
when an effectful update must be serialized. Use a full state machine only
when transition legality, queued events, or committed-transition observation
is a real requirement. `tooling/mze/src/phase-state.ts` is the local example of
that larger problem.

## HTTP boundary

Configure cross-cutting request policy once with an HTTP client transform:

```ts
client.pipe(
  HttpClient.mapRequest(
    flow(
      HttpClientRequest.prependUrl(settings.baseUrl),
      HttpClientRequest.bearerToken(settings.apiKey),
      HttpClientRequest.acceptJson,
      HttpClientRequest.setHeader("X-Odoo-Database", settings.database),
    ),
  ),
);
```

Keep each domain operation in this order:

1. Decode and normalize domain input.
2. Encode the request body with a Schema.
3. Run the request through the configured client.
4. Map transport failures once.
5. Classify HTTP status before response decoding.
6. Decode the response with its exact Schema.
7. Map decode failure to the operation's exact response error.
8. Apply the timeout around the complete request and decode workflow.

Use `Effect.retry` with a bounded `Schedule` only when the operation is safe to
repeat. Do not retry authentication, permission, validation, or arbitrary
non-idempotent failures.

## Non-Effect runtime adapter

A non-Effect entry is a boundary policy over the native service. It must not
reimplement the operation.

### Public value types

Validate local creation options before returning the client:

```ts
export function createOdooBridge(
  options: Options,
): Result.Result<OdooBridgeClient, ConfigurationError>;
```

Return typed expected failures as values from asynchronous calls:

```ts
type AsyncResult<A, E> = Promise<Result.Result<A, E>>;

export { Result } from "effect";
```

Fulfill the Promise with success or an expected failure. Reject it only for a
defect. Translate caller cancellation and client closure into named expected
errors when the adapter contract says callers can recover from them.

Effect `Result` is synchronous. It gives non-Effect callers constructors,
narrowing, matching, mapping, generators, and collection helpers without a
second Result vocabulary. Keep asynchronous composition in Effect before the
adapter boundary.

Relay the `Result` namespace from the non-Effect package entry. Callers can
create, narrow, and match results without finding a second import path. Export
a smaller capability interface only when a downstream dependency needs a
strict subset of the client. The smaller interface is a view of the same
client, not another implementation or factory.

### One runtime and one owner

Create one `ManagedRuntime` from the service layer. Supply the platform HTTP
layer there. Inject a custom `fetch` through the normal creation options and
default it to `globalThis.fetch`.

If client creation already decoded the settings, the adapter can mark repeated
service-layer decoding as an invariant:

```ts
const runtime = ManagedRuntime.make(
  OdooBridge.layer(settings).pipe(Layer.provide(FetchHttpClient.layer), Layer.orDie),
);
```

This `Layer.orDie` is valid because the adapter holds a decoded `Settings`
value. It is not a shortcut for unchecked public options.

`ManagedRuntime` owns its scope. Its installed implementation registers fibers
in that scope and closes the scope during disposal. Do not add an active-call
set or one `AbortController` per call unless a test proves that the managed
scope cannot provide the required behavior.

Expose one idempotent `close(): Promise<void>` and `[Symbol.asyncDispose]`.
Model `Open | Closing | Closed` with `Data.TaggedEnum` as shown above.

### Classify the runtime result once

Run `Effect.result(program)` through `runPromiseExit`:

```ts
return runtime
  .runPromiseExit(
    program.pipe(Effect.provideService(FetchHttpClient.Fetch, fetch), Effect.result),
    { signal: options?.signal },
  )
  .then((exit) => {
    if (Exit.isSuccess(exit)) return exit.value;
    if (Cause.hasInterruptsOnly(exit.cause)) {
      return Result.fail(interruptionError(options?.signal));
    }
    return Promise.reject(Cause.squash(exit.cause));
  });
```

The result has four policies:

| Runtime outcome                  | Adapter outcome            |
| -------------------------------- | -------------------------- |
| Effect success                   | fulfilled `Result.succeed` |
| Expected Effect failure          | fulfilled `Result.fail`    |
| Declared cancellation or closure | fulfilled named call error |
| Defect                           | rejected Promise           |

An `AbortSignal` supplied to `runPromiseExit` interrupts the outer fiber. Code
inside that fiber cannot reliably map the interruption after it occurs. Inspect
the failed `Exit` at the Promise boundary. Keep `Exit`, `Cause`, layers, and
runtime types out of the public non-Effect declarations.

When one JavaScript options object contains domain input and call controls, use
a small projection such as `Struct.pick`. Do not force callers to pass an
`undefined` placeholder, and do not use an optic to construct a new record.

## Resource and concurrency choice

Use the narrowest primitive that owns the real concern:

| Concern                                         | Primitive                                           |
| ----------------------------------------------- | --------------------------------------------------- |
| Acquire one resource and always release it      | `Effect.acquireRelease` inside `Effect.scoped`      |
| Construct an owned dependency graph             | scoped `Layer`                                      |
| Start work that must end with the current scope | `Effect.forkScoped`                                 |
| Run independent effects in parallel             | `Effect.all` or `Effect.forEach` with `concurrency` |
| Consume many values with backpressure           | `Stream`                                            |
| Hold shared atomic state                        | `Ref`                                               |
| Serialize an effectful state transition         | `SynchronizedRef`                                   |
| Wait for one result from another fiber          | `Deferred`                                          |
| Send work to one consumer                       | `Queue`                                             |
| Broadcast to many consumers                     | `PubSub`                                            |
| Read current state and observe later changes    | `SubscriptionRef`                                   |
| Retry or repeat over time                       | `Schedule`                                          |
| Cache values by key                             | `Cache`                                             |
| Cache one Effect result                         | `Effect.cached`                                     |

Use `Stream` when the module owns the multi-value lifecycle and backpressure.
Return one decoded batch when the caller owns pagination. Use a
`RequestResolver` only when the remote system has a real batch endpoint.

Use Effect `Config` when the Effect application owns configuration loading.
Use concrete options when a library caller supplies values. Do not make a
library depend on ambient configuration only to save one options object.

## Tests

Test the interface through normal accessors, layers, and package entries.

- Use Effect test services for time, random values, and configuration.
- Use `TestClock` for timeout, retry, and schedule tests. Do not sleep.
- Use `Deferred`, `Queue`, `Latch`, or `Ref` to coordinate concurrent tests.
- Assert the exact error tag and useful fields.
- Test Schema input rejection and response decoding.
- Test defects separately from expected failures.
- Test interruption, finalizers, runtime disposal, and idempotent close.
- Test that a close in progress returns the same completion.
- Test generated declarations and each ESM and CommonJS package condition.
- Test custom platform dependencies through the normal options object.
- Run the code from the built package as both an Effect and non-Effect caller.

## Common wrong turns

| Wrong turn                                       | Use instead                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `Effect.Service` for the pinned version          | `Context.Service`                                                 |
| `Schema.TaggedErrorClass` for the pinned version | `Schema.TaggedError`                                              |
| One error with a nested tagged `reason`          | Direct tagged errors and exact operation unions                   |
| A helper that only calls an error constructor    | Direct construction                                               |
| JavaScript `try`/`catch` around Effect code      | Typed Effect recovery; wrap only the throwing call                |
| `catchAll` plus one broad remap                  | `catchTag`, `catchTags`, or one narrow `mapError`                 |
| `Cause.squash` in domain code                    | Keep typed failures in `E`; squash defects only at the JS edge    |
| `Effect<Result<A, E>>` as the native operation   | `Effect<A, E, R>`                                                 |
| `runPromise` with expected Promise rejection     | `Effect.result` plus `runPromiseExit` at a typed adapter boundary |
| Several lifecycle booleans                       | `Data.TaggedEnum` and exhaustive `$match`                         |
| An active-call registry beside `ManagedRuntime`  | Managed scope ownership                                           |
| An unscoped background fiber                     | `Effect.forkScoped`                                               |
| Repeated headers and base URL logic              | One `HttpClient.mapRequest` transform                             |
| Caller-selected response generic                 | A schema-bound internal generic                                   |
| An optional service used to hide missing wiring  | A required `Context.Service` dependency                           |
| `Layer.orDie` on unvalidated options             | Preserve the configuration error or validate earlier              |
| An Optic that constructs a new record            | Direct construction or `Struct.pick`                              |
| A full state machine for three simple states     | `Data.TaggedEnum`; escalate only for real transition rules        |

## Completion checklist

An Effect interface change is complete only when every relevant statement is
true:

- [ ] Every version-sensitive symbol exists in the installed Effect source or
      declarations.
- [ ] The native operations use exact `Effect.Effect<A, E, R>` channels.
- [ ] Each important workflow has a stable `Effect.fn` name.
- [ ] Services, references, layers, and accessors each hide a real concern.
- [ ] Layer requirements and construction errors remain visible until their
      owner handles them.
- [ ] Expected errors use direct tags and exact operation unions.
- [ ] JavaScript `try`/`catch` does not replace Effect error control.
- [ ] `Effect.orDie`, `Effect.ignore`, and `Cause.squash` each have a proved
      boundary policy.
- [ ] All untrusted values are decoded at the first trust boundary.
- [ ] Secrets become `Redacted` at the first trusted point.
- [ ] Boolean state clusters are replaced with a closed state model.
- [ ] Shared mutable state uses the correct Effect concurrency primitive.
- [ ] Resource acquisition, fibers, interruption, and cleanup have one scope.
- [ ] A non-Effect adapter reuses the native operations and hides runtime types.
- [ ] Promise fulfillment, rejection, cancellation, and closure policies are
      explicit and tested.
- [ ] Namespace and flat exports match their caller audience.
- [ ] Tests use deterministic Effect controls and cover failure and cleanup.
- [ ] The general API-design checklist also passes.

## Repository references

- [`packages/odoo-bridge/src/odoo-bridge.ts`](../../packages/odoo-bridge/src/odoo-bridge.ts)
  shows `Interface`, `Context.Service`, `make`, `layer`, accessors, and the
  service namespace.
- [`packages/odoo-bridge/src/client.ts`](../../packages/odoo-bridge/src/client.ts)
  shows `Result`, `ManagedRuntime`, `Data.TaggedEnum`, runtime result
  classification, and asynchronous disposal.
- [`packages/odoo-bridge/src/internal/options.ts`](../../packages/odoo-bridge/src/internal/options.ts)
  shows pure `Result` decoding, defaults, URL validation, `Duration`, and
  `Redacted`.
- [`packages/odoo-bridge/src/internal/http-client.ts`](../../packages/odoo-bridge/src/internal/http-client.ts)
  shows one HTTP client transform, a schema-bound generic, status policy,
  response decoding, and timeout recovery.
- [`packages/odoo-bridge/src/internal/contract-check.ts`](../../packages/odoo-bridge/src/internal/contract-check.ts)
  shows direct yieldable domain errors.
- [`tooling/mze/src/child-command.ts`](../../tooling/mze/src/child-command.ts)
  shows services, a safe `Context.Reference`, scoped processes, streams,
  parallel drains, and `Ref`.
- [`tooling/mze/src/output.ts`](../../tooling/mze/src/output.ts) shows a truly
  optional service read with `Effect.serviceOption`.
- [`tooling/mze/src/phase-state.ts`](../../tooling/mze/src/phase-state.ts) shows
  when legal transitions and committed events justify a full state machine.

For the pinned API, inspect `Effect.ts`, `Result.ts`, `Context.ts`, `Schema.ts`,
`Data.ts`, `Layer.ts`, `ManagedRuntime.ts`, `Ref.ts`, `SynchronizedRef.ts`,
`Stream.ts`, `Schedule.ts`, `Cache.ts`, and the unstable HTTP modules under
`node_modules/effect/src`.
