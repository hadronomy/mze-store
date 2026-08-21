# Effect v4 boundary research

**Status:** Research basis. The implemented Result boundary is recorded in
[`odoo-bridge-effect-result-interface.md`](./odoo-bridge-effect-result-interface.md).

**Checked:** 2026-08-20 against `effect@4.0.0-rc.109` in this worktree and
the current Effect v4 source. This note records boundary findings. It does not
choose the final `odoo-bridge` method names or call shapes.

## Research conclusion

Use one managed runtime for one bridge client. Build the application layer once,
run many Effects through that runtime, and dispose it with the client or host
process. Keep the Result client as a small adapter over the native Effect
service. Do not provision the bridge layer inside every client method.

This gives Effect consumers the normal v4 service, layer, Schema, error, and
interruption model. It gives Medusa Promise methods that fulfill with Effect
`Result` values. The runtime boundary also gives both consumers the same
service instance, resource scope, and cancellation behavior.

## Findings from Effect v4

### Services and module shape

Effect v4 uses `Context.Service` for application services. A service class is a
context key and a yieldable Effect. Its interface contains methods that return
Effects, and its implementation is built with `Layer.effect` and
`Service.of`. The pinned source and the current upstream source use this shape;
the v4 migration guide also names `Context.Service` as the replacement for
`Context.Tag`. No `ServiceMap.Service` API exists in the pinned package or the
current upstream package. See the [pinned Context source](../../node_modules/effect/src/Context.ts),
the [current Context source](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Context.ts),
and the [v4 migration guide](https://github.com/Effect-TS/effect/blob/main/MIGRATION.md).

The method body belongs in `Effect.fn("Service.operation")`. Effect documents
the named form as a tracing span and a stack-trace name. The generator body can
then express the workflow without manually assembling tracing or diagnostic
metadata. The [pinned `Effect.fn` source](../../node_modules/effect/src/Effect.ts)
and the repository's [MZE service example](../../tooling/mze/src/child-command.ts)
show the same pattern.

Keep the service module as the intentional Effect surface. Export the service,
its errors, its layer constructors, and its contract types from the Effect
entry point. Keep transport details and runtime assembly private. This follows
the first-party module style and the existing `tooling/mze` service modules.

### Runtime ownership is the important boundary

`ManagedRuntime.make(layer)` exists for an application entry point or an
integration that runs many Effects. It builds the layer lazily on first use,
caches the resulting context, owns the acquired resources, and releases them
when `dispose` or `disposeEffect` runs. Its `runPromise` accepts an external
`AbortSignal`. These guarantees are explicit in the [pinned
`ManagedRuntime` implementation](../../node_modules/effect/src/ManagedRuntime.ts)
and the [current upstream source](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/ManagedRuntime.ts).

The first-party Hono integration uses this exact framework boundary: it creates
one `ManagedRuntime` from a service layer, calls `runtime.runPromise` for each
handler, and disposes the runtime during shutdown. See the [pinned first-party
integration](../../node_modules/effect/ai-docs/src/04_integration/10_managed-runtime.ts).
This is the strongest precedent for a non-Effect web consumer.

`Effect.provide(effect, layer)` has a different lifetime. The pinned internal
implementation wraps the operation in `scopedWith`, builds the layer in that
operation's scope, and supplies its context to that operation. See the [pinned
layer implementation](../../node_modules/effect/src/internal/layer.ts). Layer
memoization can be shared when a caller supplies a shared memo map, but a plain
`runPromise` call does not create a process-wide application runtime. Resources
acquired by repeated per-operation provisioning belong to repeated operation
scopes.

That distinction mattered in the superseded bridge. Its Promise adapter stored
a `Layer` value, then called `Effect.provide` inside each method. The layer value
was reused, but its service instance and service-local cached Effects were not
long-lived client state. A cached verification Effect therefore did not cache
verification across Promise calls.

| Boundary                       | Layer build            | Resource lifetime        | Appropriate use                                        |
| ------------------------------ | ---------------------- | ------------------------ | ------------------------------------------------------ |
| `ManagedRuntime`               | Once, on first run     | Until runtime disposal   | A bridge client, web app, worker, or host process      |
| `Effect.provide` per operation | In the operation scope | Ends with that operation | A one-off program, a test, or a deliberate short scope |

The Promise constructor therefore needs an explicit ownership rule: it owns a
runtime and exposes a disposal operation, or it receives a runtime owner from
the host. The final API design must make that lifecycle visible. A hidden global
runtime makes tests, credentials, and shutdown behavior ambiguous.

### Promise errors and cancellation

`Effect.runPromise` resolves the success value and rejects with the first typed
failure or exception. `runPromiseExit` returns an `Exit` when a boundary needs
to inspect success, typed failure, defect, and interruption separately. See the
[pinned runPromise documentation](../../node_modules/effect/src/Effect.ts) and
the [current upstream Effect source](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Effect.ts).

The Promise edge must preserve the domain error object. Do not catch every
rejection and replace it with a generic Error. If the edge maps cancellation to
a domain error, inspect the full `Cause` and map only an interrupt-only cause;
do not turn defects or a real bridge failure into cancellation. The pinned
`Cause.hasInterruptsOnly` implementation is [here](../../node_modules/effect/src/Cause.ts).

Pass the caller's `AbortSignal` to `runtime.runPromise(effect, { signal })`.
Inside a transport adapter, use `Effect.tryPromise` or `Effect.promise` and pass
the signal received by the thunk to `fetch` or the HTTP client. Effect aborts
that signal when the owning scope interrupts the fiber. See the [pinned promise
and abort-signal documentation](../../node_modules/effect/src/Effect.ts).
Keep timeout policy in the Effect workflow with Effect's timeout and schedule
primitives. A second hand-written Promise timer creates a race between timeout,
request abort, iterator close, and error mapping.

### Streams and `AsyncIterable`

If an API owns lazy pagination, `Stream` models pull, backpressure, typed
failure, scope, and interruption. Issue #131 gives cursor progression and
durable pagination to Medusa, so this fact does not require the Odoo bridge to
expose a stream.

For a non-Effect consumer of any future stream, Effect provides the official adapter
`Stream.toAsyncIterableWith(stream, context)`. The adapter creates a scope for
the iterator, runs pulls with the supplied context, interrupts an in-flight
pull on `return()`, and closes the scope. `Stream.toAsyncIterableEffect` creates
the iterable inside an Effect when the current context is already available.
See the [pinned Stream adapter](../../node_modules/effect/src/Stream.ts) and the
[current upstream source](https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Stream.ts).

The adapter throws `Cause.squash` for a failed pull. A typed domain error reaches
the async iterator as the rejected value, but the complete Effect `Cause` is no
longer available. The Promise API must document this error contract. It must
also keep the runtime alive for the entire iteration; disposing the runtime
before the consumer calls `return()` invalidates the stream's context.

Do not hand-roll an iterator scope, fiber interruption, and close timer unless
the final API has a requirement that the official adapter cannot meet.

### Config, Schema, and HTTP

Resolve and validate options while the runtime layer builds. A host-driven
configuration layer can use `Config` and `Config.schema`. A first-party-style
client can also accept concrete options. See the [pinned Config source](../../node_modules/effect/src/Config.ts).

Use `Schema.Struct` for request and response contracts, decode unknown JSON at
the transport boundary with `Schema.decodeUnknownEffect`, and use
schema-backed tagged errors. Keep the Odoo wire contract in the schema module so
the Effect and Promise edges share one codec. See the [pinned Schema source](../../node_modules/effect/src/Schema.ts).

The unstable v4 HTTP client already models request construction, bearer
authentication, status filtering, JSON schema decoding, abort signals, and
transient retry. A bridge HTTP adapter can use those primitives while keeping
`HttpClient` types private to the adapter. Retry only idempotent bridge reads.
See [`HttpClient`](../../node_modules/effect/src/unstable/http/HttpClient.ts),
[`HttpClientRequest`](../../node_modules/effect/src/unstable/http/HttpClientRequest.ts),
and [`HttpClientResponse`](../../node_modules/effect/src/unstable/http/HttpClientResponse.ts).

## Package boundary implications

The repository's Medusa loader is a synchronous CommonJS `require()` boundary;
ADR-0012 requires shared backend packages to emit CommonJS. Keep an Effect
entry point for native consumers and a Promise entry point that has no Effect
types in its method declarations. Conditional ESM/CommonJS exports preserve
that boundary. The final API can put the common Promise client at the package
root and reserve explicit subpaths for Effect and contract consumers. See
[ADR-0012](../adr/0012-medusa-cjs-interop.md), the [current package
exports](../../packages/odoo-bridge/package.json), and the [Effect package
export map](../../node_modules/effect/package.json).

The Promise edge imports private implementation modules only through the
package's internal graph. Consumers do not need to know about layers, contexts,
`ManagedRuntime`, transports, or `Stream` conversion. The Effect edge does not
depend on the Promise adapter. This keeps type ownership clear and
prevents a CommonJS consumer from importing the Effect graph by accident.

## Constraints for the design pass

1. Make runtime ownership and disposal explicit for every Promise bridge client.
2. Build configuration, HTTP services, and caches in the managed layer.
3. Run each Promise operation through the same managed runtime instance.
4. Pass `AbortSignal` to the runtime and through every external I/O call.
5. Use the official `Stream` to `AsyncIterable` adapter if a future API owns a
   lazy stream.
6. Preserve tagged domain failures and document stream rejection behavior.
7. Keep Effect and Promise entry points separate, with ESM and CJS exports.
8. Use `Context.Service`, `Layer`, `Effect.fn`, `Schema`, and HTTP primitives as
   the implementation vocabulary. Use `Config` when a host-driven configuration
   layer owns the values. Do not invent a v4 `ServiceMap.Service` abstraction.
