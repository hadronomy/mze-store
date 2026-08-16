# Varlock owns the environment contract, and no package wraps it

Every environment variable in this repository is declared once, in a committed `.env.schema`. The root file holds the shared resource fragments. Each consumer that starts a process keeps its own schema beside its code and pulls the root in with `@import(../../)`. Varlock validates, resolves, and injects. Nothing else does.

`packages/env` is deleted. It exported three entries built on two different shapes — an eager `createEnv` singleton for the storefront, and a `schema.parse(source)` function for Medusa and drizzle-kit — and it validated `DATABASE_URL` with `z.string().min(1)`, which accepts the string `x`.

## Why no wrapper package survives

`@generateTsTypes(path=./env.ts, exposeEnv=local)` writes a package-local module that exports `ENV` typed from the schema. That gives each consumer its own type with no global `ProcessEnv` augmentation, so `apps/medusa` cannot see `BETTER_AUTH_SECRET` in its types. A wrapper would add an import path and hide nothing.

Reading through `ENV` rather than `process.env` is what makes a missed wrapper loud:

```
Error: varlock ENV not initialized — make sure varlock is set up correctly.
```

Exit code 1, at the first property access. `process.env.DATABASE_URL` returns `undefined` in the same situation and hands it to the Postgres driver.

## Why the CJS island is not an exception

ADR-0012 pins the Medusa backend to ts-node 10.9.2, which refuses ESM. `varlock/env` is ESM only and ships no CommonJS build. Node 24's `require(esm)` bridges it: ts-node compiles `medusa-config.ts` to CommonJS, emits `require("./env")`, and the generated module's `import` of `varlock/env` resolves. Measured, not assumed — see `docs/research/varlock-spike.md`.

`medusa-config.ts` therefore reads `ENV` like every other consumer, and its `loadEnv()` call is deleted. That call was the only source of silent failure in the repository: it populated `process.env` from a file and let a missing value stay missing.

## Consequences

- **Derived values are schema expressions, not code.** `apps/medusa/src/portless.ts` is deleted. The three CORS items resolve through `if($PORTLESS_ACTIVE, …)`, and `PORTLESS_ACTIVE` is one expression rather than a predicate repeated in two packages. The storefront's `BETTER_AUTH_URL` and `CORS_ORIGIN` overlay the same way, replacing the mutation that `packages/env/src/server.ts` performed on a copy of `process.env`.

- **`DATABASE_URL` is composed from the parts that vary.** The root schema builds it from `${DB_USERNAME}`, `${DB_PASSWORD}`, `${DB_HOST}` and `${DB_PORT}`. `tooling/mze` discovers the Compose ports and injects the parts, so the connection string exists in one place instead of being written in `tooling/mze/services.ts` and separately validated in `packages/env`.

- **The discovered items carry no defaults, on purpose.** `DB_PORT`, `DB_PASSWORD` and `REDIS_PORT` are `@required` with no value. A default would let a renamed injection key fall back to 5432 and reach a different database than the worktree started. The cost is that any command run outside `mze` must say which environment it is in.

- **`.env.build` joins `.env.test` as a committed placeholder file.** `medusa build` evaluates `medusa-config.ts`, so a build needs values. `APP_ENV=build` loads placeholders and keeps validation on, replacing `SKIP_ENV_VALIDATION=1`, which turned validation off and returned the raw source typed as though it had been validated. Under that flag `NODE_ENV` was typed as a three-member enum while being `undefined`.

- **Type generation does not need valid values.** Varlock writes `env.ts` even when validation fails, so `check-types` runs on a clean clone with no database and no secrets. The generated files are git-ignored, matching `apps/storefront/src/routeTree.gen.ts`.

- **`APP_ENV` is the environment switch, and `NODE_ENV` is left alone.** Node, Vite and Medusa each define `NODE_ENV` for themselves. Overloading it as a fourth switch is how two meanings drift apart.

- **Bun's own `.env` loader is turned off.** `bunfig.toml` sets `env = false`. Two resolvers reading the same files with different precedence disagree eventually.

- **Secrets are marked one by one.** `@defaultSensitive=false` is set in every file header. The varlock default marks everything sensitive, which redacted the Vite dev server's own URL in terminal output during the spike.

- **CORS validates the union Medusa accepts.** Each comma-separated entry must be an absolute origin or a slash-delimited regular expression, because the Portless patterns take the second form and a worktree label varies inside the host name.

- **`packages/auth` declares a schema it does not run.** The Storefront hosts the Account service, so the Storefront's `varlock run` supplies the values. The schema exists to type the reads in `src/instance.ts`, and it must stay a strict subset of the Storefront's — an item declared in one and missing from the other compiles and then fails at run time.

- **Contract unit tests are gone.** The 324-line child-process suite in `packages/env/test` proved module resolution for a package that no longer exists. CI runs `varlock load` per schema instead, which exits 1 on an invalid contract.

- **Every process needs a wrapper.** `varlock run` prefixes the Medusa and drizzle-kit scripts; the Vite plugin covers the Storefront. A process started without one fails loudly, which is the trade this decision accepts in exchange for deleting the package.

## Related

- ADR-0012 — the Medusa backend is a tsc island. Why the CJS question had to be measured.
- ADR-0020 — the auth instance is constructed lazily. Its build-time argument now rests on `.env.build` rather than `SKIP_ENV_VALIDATION`.
- ADR-0006 — Redis from the first deploy. Why `REDIS_URL` is required rather than optional.
