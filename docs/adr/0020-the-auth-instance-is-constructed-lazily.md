# The auth instance is constructed lazily, not injected

`createAuth` is a pure function. It takes its database and its configuration as parameters and reads nothing from the environment. `getAuth`, in a separate entry, memoises one instance and is the only module that reads `@mze-store/env`. Consumers import `@mze-store/auth/instance`. Tests import `@mze-store/auth`.

Before this, `packages/auth` and `packages/db` each exported a factory and an eager singleton built from it. The factories had no callers. Importing `@mze-store/auth` — even for a type — opened a Postgres pool and validated the whole server environment, so nothing that touched an Account could be tested without a live database.

## Why not dependency injection

The storefront has two request pipelines. TanStack Start middleware and file-route handlers run in one. Nitro middleware under `server/` runs in the other, before TanStack sees the request. They share no context object.

A composition root that constructs the instance and passes it down reaches `src/middleware/auth.ts` and `src/routes/api/auth/$.ts`. It does not reach `server/middleware/evlog-auth.ts`, which needs the same instance. Injection therefore needs a second mechanism for the third consumer, and that mechanism is a module-level accessor — this decision, with more steps.

## Why a process-global is acceptable

ADR-0004 already puts in-process state at this layer. The Medusa token cache is keyed by the better-auth session token and held per instance, and that ADR states it "needs no shared cache and does not constrain instance count". A memoised auth instance sits on the same grain.

The cost is narrow and real: two auth configurations cannot be alive in one process at the same time. Nothing in the Account bridge, the admin extension, or Erasure asks for that.

## Consequences

- **The entry is split so the pure half stays pure.** `getAuth` cannot live beside `createAuth`, because a module-scope `import { env }` validates on import and would put the failure back where it was. `packages/db` loses its env import for the same reason — `createDb` takes a URL — since `packages/auth` imports it and would otherwise inherit the validation transitively.

- **Omitting the database gives a second adapter for free.** better-auth falls back to `@better-auth/memory-adapter` when `database` is undefined, and that package is already a direct dependency of `better-auth`. The seam is real rather than hypothetical: Drizzle over Postgres in production, memory in tests, and a Postgres-backed Drizzle instance for the few tests that must prove the mapping.

- **The interface is the better-auth instance, not a facade.** `evlog`'s `createAuthMiddleware` takes the instance, so a narrower surface would have to expose it again immediately. `packages/auth` owns configuration. Domain operations that Erasure and Claim need are added beside the instance, not in front of it.

- **A memory-adapter test proves configuration, not schema.** It exercises the plugin chain and the email-and-password setup with no database and no Docker. It says nothing about the Drizzle mapping or about ADR-0007's schema placement, which stay the job of a migration check against real Postgres.

- **`getAuth` is callable from anywhere.** The type system will not stop a module reaching for the global where it should have taken an instance. That is a review habit, not a guarantee.

- **The backend is unaffected.** Medusa never imports this package. It verifies better-auth JWTs over JWKS, so the CJS constraint in ADR-0012 does not reach here.

## Related

- ADR-0003 — better-auth owns Shopper identity. What this module is the instance of.
- ADR-0004 — the Medusa token is server-only. Already accepts in-process state at this layer.
- ADR-0012 — the Medusa backend is a tsc island. Does not apply, because the backend does not import this package.
- ADR-0013 — Token Exchange, not shared signing. Why the backend reaches better-auth over JWKS instead of importing it.
