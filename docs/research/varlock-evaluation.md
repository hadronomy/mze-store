# Varlock: a deep evaluation

**Date checked:** 2026-08-15

**Scope:** `varlock@1.16.1` alone. This document tests the dismissal recorded in
[`typed-environment-libraries.md`](./typed-environment-libraries.md). It does
not repeat that document's six-way comparison.

**Sources:** the official docs site, its source in the varlock repository
(`packages/varlock-website/src/content/docs/`), the `varlock` package source,
the CHANGELOG, the GitHub API, and the npm registry. Claims marked **measured**
come from running `varlock@1.16.1` on macOS with Node 24 and Bun 1.3.14 on
2026-08-15. Where a source says nothing, this document says so.

## Question

The previous pass set varlock aside in one paragraph: the strongest project of
the six, the only one that solves template generation, but it costs zod, costs
Standard Schema, and "puts a CLI in front of every process".

Two of those three claims are correct. The third is wrong in an interesting way.
This document works out what that changes.

## Result

**Do not adopt varlock as the replacement for `packages/env`. Keep plain zod v4.**

The decision does not turn on features. Varlock covers more of the twelve
settled decisions than any library in the previous comparison, and it answers
three of them better than the zod plan does — derived values (decision 4),
producer-side URL composition (decision 9), and an honestly typed build path
(decision 5). Those are real wins and this document shows them working.

The decision turns on one fact: **varlock has no library API that validates an
explicit source object.** Every documented entry point is a process boundary —
either the `varlock` CLI wraps your process, or `varlock/auto-load` spawns that
CLI with `execSync` when your module graph loads. Decision 2 (explicit source
object, no module-level `process.env` read) and decision 10 (`loadSource({ cwd })`
returning a plain object) are not features varlock declines to ship. They are
the opposite of its design.

Adopting varlock means deleting `packages/env` rather than reimplementing it,
and moving three of the twelve decisions from "settled" to "does not apply".

There is a credible narrow use that costs almost nothing. See
[The hybrid option](#the-hybrid-option).

## Fit against the twelve decisions

| #   | Decision                                                        | Verdict                                                                           |
| --- | --------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | Env package owns declaration and generates `.env.template`      | Conflicts — varlock replaces templates, it does not generate them                 |
| 2   | Factories taking an explicit source object                      | Conflicts — no such API exists                                                    |
| 3   | Cheap seam for a future browser contract                        | Fits — better than the current plan                                               |
| 4   | Portless overlay as an explicit named overlay                   | Fits with work — the rewrite is declarative, the "explicit overlay" shape is lost |
| 5   | One skip mechanism, honestly typed, defaults still apply        | Fits — and solves the problem the zod plan has to build                           |
| 6   | `development` export condition plus dual ESM+CJS `dist`         | Fits with work — question changes shape; ts-node is the risk                      |
| 7   | Fragments composed into consumer contracts                      | Fits — `@import(..., pick=[...])` is the right primitive                          |
| 8   | Fragments live centrally in `packages/env`                      | Fits with work — supported, but against the documented recommendation             |
| 9   | Producer side shares one URL definition with the contract       | Fits — clearly better than the current duplication                                |
| 10  | `loadSource({ cwd })` returns a plain object                    | Conflicts — no library API                                                        |
| 11  | Templates generated, CI fails on diff; `.env.test` hand-written | Conflicts on the first half, fits on the second                                   |
| 12  | Custom failure report grouped by fragment                       | Conflicts — varlock owns the report and it is not extensible                      |

Four conflicts, three of which (2, 10, 12) are load-bearing design choices this
repository made on purpose.

## What varlock is

Varlock is a CLI plus a DSL. The DSL is `@env-spec`, a separate specification
with its own parser package and RFC
([`@env-spec` overview](https://varlock.dev/env-spec/overview/)). The schema is
a committed `.env.schema` file. Rules live in JSDoc-style decorator comments.

```env-spec title=".env.schema"
# @currentEnv=$APP_ENV
# @defaultSensitive=false @defaultRequired=infer
# @generateTsTypes(path=./env.d.ts)
# ---

# @type=enum(development, staging, production)
APP_ENV=development

# @required @sensitive @type=string(startsWith=sk_)
# @docs(https://docs.stripe.com/keys)
STRIPE_API_KEY=
```

Source: [Schema guide](https://varlock.dev/guides/schema/),
[`packages/varlock/README.md`](https://github.com/dmno-dev/varlock/blob/main/packages/varlock/README.md).

Header comment blocks carry root decorators. A comment block directly above an
item carries item decorators. A blank line or a `# ---` divider breaks the
block. A standalone comment counts as a decorator line only when its content
starts with `@`.

### Item decorators

Full list from
[item decorators reference](https://varlock.dev/reference/item-decorators/):

| Decorator      | Value                     | Purpose                                                                                     |
| -------------- | ------------------------- | ------------------------------------------------------------------------------------------- |
| `@required`    | boolean                   | Fail validation when the value is `undefined` or empty                                      |
| `@optional`    | boolean                   | `@required=false`                                                                           |
| `@sensitive`   | boolean or object         | Redact in output; drive client integrations. Object form takes `enabled` and `preventLeaks` |
| `@public`      | boolean                   | `@sensitive=false`                                                                          |
| `@internal`    | boolean                   | Resolve it, but never inject it into the app or child processes                             |
| `@dynamic`     | boolean                   | Resolve at runtime instead of inlining at build time                                        |
| `@static`      | boolean                   | `@dynamic=false`                                                                            |
| `@type`        | data type                 | Coercion, validation, and generated type                                                    |
| `@example`     | string                    | Sample value, without setting a placeholder                                                 |
| `@docs()`      | url, or description + url | Documentation link, callable more than once                                                 |
| `@tag()`       | one or more tags          | Selector for `--filter` and for `filter=` on generators                                     |
| `@icon`        | string                    | Iconify id, carried into generated types                                                    |
| `@deprecated`  | boolean or string         | Emits a `@deprecated` JSDoc tag                                                             |
| `@auditIgnore` | boolean                   | Suppress "unused in schema" warnings from `varlock audit`                                   |
| `@placeholder` | string                    | Value an untrusted child process sees under the credential proxy                            |
| `@proxy`       | function or value         | Credential-proxy routing                                                                    |
| `@docsUrl`     | string                    | Deprecated; use `@docs()`                                                                   |

### Root decorators

From
[root decorators reference](https://varlock.dev/reference/root-decorators/):
`@currentEnv`, `@defaultRequired`, `@defaultSensitive`, `@defaultDynamic`,
`@disable`, `@import()`, `@setValuesBulk()`, `@plugin()`, `@cache`,
`@redactLogs`, `@preventLeaks`, `@encryptInjectedEnv`,
`@disableProcessEnvInjection`, `@auditIgnorePaths()`, `@proxyConfig`,
`@proxy()`, plus the seven `@generate*` code-generation decorators.
`@envFlag` is deprecated in favour of `@currentEnv`.

### The type system

Built-in types, from
[data types reference](https://varlock.dev/reference/data-types/): `string`,
`number`, `boolean`, `url`, `enum`, `email`, `port`, `ip`, `semver`, `isoDate`,
`uuid`, `md5`, `simple-object`, `duration`, `array`, `record`. Plugins register
more.

The three zod expressions the question asks about all translate directly:

| zod v4                         | `@env-spec`                    |
| ------------------------------ | ------------------------------ |
| `z.string().startsWith("sk_")` | `@type=string(startsWith=sk_)` |
| `z.string().min(32)`           | `@type=string(minLength=32)`   |
| `z.url()`                      | `@type=url`                    |

`string` also takes `maxLength`, `isLength`, `endsWith`, `matches` (a
`/pattern/flags` literal or a quoted pattern), `toUpperCase`, `toLowerCase`, and
`allowEmpty`. `url` takes `prependHttps`, `allowedDomains`, `noTrailingSlash`,
and `matches`. Coercion runs before validation: `@type=number(precision=0,
max=100)` on `"123.45"` goes `"123.45"` → `123.45` → `123` → invalid.

Two things zod does that `@env-spec` does not. There is no `.transform()` —
coercion is whatever the named type does, and you cannot write your own coercion
in the schema. There is no `.refine()` with a custom predicate; you get the
option set each type ships. `@env-spec` gains an axis zod lacks in exchange:
**type options can themselves be resolver functions**, so validation varies by
environment.

```env-spec
# stricter length requirement in production
# @type=string(minLength=if(eq($APP_ENV, production), 32, 8))
API_TOKEN=
```

One documented constraint on that: all branches must generate the same
TypeScript type. `url` and `string` both generate `string`, so switching between
them is allowed; switching between `number` and `string` is a schema error.

Source: [data types reference](https://varlock.dev/reference/data-types/).

### Generated TypeScript types

`@generateTsTypes(path=./env.d.ts)` writes a real declaration file. **Measured**
output for a schema shaped like this repository's Medusa contract:

```ts
export type CoercedEnvSchema = {
  /** **APP_ENV** */
  APP_ENV: "development" | "production" | "test";
  /** **STRIPE_API_KEY** 🔐 _sensitive_ */
  STRIPE_API_KEY: string;
  /** **PORTLESS_URL** */
  PORTLESS_URL?: string;
  /** **STORE_CORS** — derived Portless overlay */
  STORE_CORS: string;
};

declare module "varlock/env" {
  export interface TypedEnvSchema extends Readonly<_CoercedEnvSchema_d2829c01> {}
  export interface PublicTypedEnvSchema extends Readonly<
    Pick<
      _CoercedEnvSchema_d2829c01,
      "APP_ENV" | "BETTER_AUTH_SECRET" | "CORS_ORIGIN" | "PORTLESS_URL" | "STORE_CORS"
    >
  > {}
}

declare global {
  interface ImportMetaEnv extends _EnvSchemaAsStrings_d2829c01 {}
  namespace NodeJS {
    interface ProcessEnv extends _EnvSchemaAsStrings_d2829c01 {}
  }
}
```

Three details that matter. Enums become literal unions. Non-required items get
`?`. The file both augments the `varlock/env` module and augments the global
`process.env` and `import.meta.env`. `exposeEnv=local` turns the global
augmentation off and exports a package-local `ENV` instead, which the docs
recommend in monorepos where packages carry different schemas.

Application code reads `import { ENV } from 'varlock/env'`. Generators also
exist for Python, Rust, Go, PHP, Java, and C#.

Source: [Code generation guide](https://varlock.dev/guides/code-generation/),
[`@generateTsTypes`](https://varlock.dev/reference/root-decorators/#generatetstypes).

### Derived and computed values

This is decision 4 and decision 9, and varlock answers both. Values may be
functions, functions compose, and `${OTHER}` expansion is sugar for `ref()`.

Core: `ref()`, `concat()`, `exec()`, `fallback()`, `remap()`.
Utility: `ifs()`, `forEnv()`, `eq()`, `if()`, `not()`, `isEmpty()`.
Generators: `randomNum()`, `randomUuid()`, `randomHex()`, `randomString()`,
`generateOtp()`. Plus `cache()`, `varlock()`, and `keychain()`.

Source: [functions reference](https://varlock.dev/reference/functions/).

**Measured.** The Portless overlay expressed declaratively:

```env-spec
PORTLESS_URL=
STORE_CORS=if(not(isEmpty($PORTLESS_URL)), $PORTLESS_URL, $CORS_ORIGIN)
```

With `PORTLESS_URL` unset, `ENV.STORE_CORS` is `http://localhost:3001`. With
`PORTLESS_URL=https://feature.storefront.mze-store.localhost`, `ENV.STORE_CORS`
is that URL. No application code runs.

**Measured.** Decision 9, connection URLs built from parts:

```env-spec
DB_HOST=localhost
# @type=port
DB_PORT=5432
DB_USERNAME=postgres
# @sensitive
DB_PASSWORD=password
# @required
DATABASE_URL=postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/mze-store?sslmode=disable
# @type=port
REDIS_PORT=6379
# @required
REDIS_URL=redis://${DB_HOST}:${REDIS_PORT}
```

Running with `DB_PORT=54321 REDIS_PORT=63791` in the process environment yields
`postgresql://postgres:password@localhost:54321/mze-store?sslmode=disable` and
`redis://localhost:63791`. Process overrides always take highest precedence
([Environments guide](https://varlock.dev/guides/environments/#process-overrides)),
so an explicit `DATABASE_URL` override still wins over the composed value —
confirmed by `varlock printenv DATABASE_URL`.

That is a real improvement over
[`tooling/mze/services.ts`](../../tooling/mze/services.ts), where the URL
template is written in TypeScript and the schema that validates it lives
somewhere else. Under varlock, `services.ts` would inject two port numbers and
stop knowing what a PostgreSQL URL looks like.

### Secret handling and leak prevention

Sensitivity is a decorator, not a prefix. Four layers sit on top of it:

1. **CLI redaction.** Always on. Sensitive values print as `sk▒▒▒▒▒`.
2. **Log redaction** (`@redactLogs`, default `true`). Patches the global
   `console`. **Measured:** `console.log(process.env.STRIPE_API_KEY)` printed
   `sk▒▒▒▒▒`, and a `JSON.stringify` of an object containing the value was
   redacted too.
3. **Leak prevention** (`@preventLeaks`, default `true`). Scans outgoing HTTP
   responses for sensitive values.
4. **`varlock scan`.** Scans project files or build output for plaintext
   secrets. Exits 1 on a hit, so it works as a pre-commit hook or CI gate.

Layers 2 and 3 apply "only in JavaScript based projects where varlock runtime
code is imported", and the docs warn about a performance cost for both. Both are
switchable per project, and `@sensitive={preventLeaks=false}` switches leak
detection off for one item.

The machinery is therefore optional but **default-on**, and it is global when
on. For this repository that is a live concern: `tooling/mze` has a JSON output
mode (`Output.Mode`), and a patched global `console` sits between that code and
stdout.

Sources: [Secrets guide](https://varlock.dev/guides/secrets/),
[`@redactLogs`](https://varlock.dev/reference/root-decorators/#redactlogs),
[`@preventLeaks`](https://varlock.dev/reference/root-decorators/#preventleaks),
[`varlock scan`](https://varlock.dev/reference/cli/project/#scan).

### Multi-environment support

`@currentEnv=$APP_ENV` names an item as the environment flag. Files load in
increasing precedence: `.env.schema`, `.env`, `.env.local`,
`.env.[currentEnv]`, `.env.[currentEnv].local`. Process overrides beat all of
them. The docs explicitly recommend against `NODE_ENV` as the flag, "as it has
other implications, and is often set out of your control".

`.env.local` is loaded in the `test` environment by default, matching Vite
rather than Next.js. Opt out with `# @disable=forEnv(test)` inside `.env.local`.

Source: [Environments guide](https://varlock.dev/guides/environments/).

### External secret providers

Opt-in, via `@plugin()`. Official plugins cover 1Password, AWS Secrets Manager
and Parameter Store, Azure Key Vault, Bitwarden, Google Secret Manager,
HashiCorp Vault, Infisical, Doppler, Akeyless, Keeper, KeePass, Dashlane,
Passbolt, Proton Pass, `pass`, macOS Keychain, and Kubernetes. Nothing loads
unless the schema names it. `exec()` covers providers with no plugin. Local
device-bound encryption (`varlock()`, `keychain()`) needs no provider at all.

This is the part of varlock this repository does not currently need. It is also
the part the previous research called "the different question", and that reading
holds up.

Source: [plugins overview](https://varlock.dev/plugins/overview/).

## Integration

### Is there a programmatic API?

**No documented one.** This is the deciding fact.

The published root export is:

```ts
export async function load() {
  checkBunVersion();
  // TODO: add some options
  const envGraph = await loadVarlockEnvGraph();
  await envGraph.resolveEnvValues();
  checkForConfigErrors(envGraph);

  process.env.__VARLOCK_ENV = JSON.stringify(envGraph.getSerializedGraph());
  initVarlockEnv();
  // TODO: return resolved env and schema / meta info
}
```

Source:
[`packages/varlock/src/index.ts`](https://github.com/dmno-dev/varlock/blob/main/packages/varlock/src/index.ts).

Read the two `TODO` comments literally. `load()` takes no options, returns
nothing, and writes into `process.env`. It is `async`, so it cannot run at
module scope in a synchronous loader — which rules out `medusa-config.ts` and
`drizzle.config.ts` on its own.

One level down there is an `internal` export carrying `EnvGraph`,
`DotEnvFileDataSource`, and `loadEnvGraph`. `loadEnvGraph` does accept explicit
values:

```ts
export async function loadEnvGraph(opts?: {
  basePath?: string;
  entryFilePaths?: string | Array<string>;
  /** Explicit process.env override values used for config item override precedence */
  overrideValues?: Record<string, string | undefined>;
  /** Explicit process.env values used by builtin var detection */
  processEnvOverride?: Record<string, string | undefined>;
  // ...
});
```

Source:
[`packages/varlock/src/env-graph/lib/loader.ts`](https://github.com/dmno-dev/varlock/blob/main/packages/varlock/src/env-graph/lib/loader.ts).

That is close to decision 2, and it is not usable. The schema still comes from
files on disk resolved from a `basePath`, the function is `async`, the export is
named `internal`, and the docs never mention it. A search of the whole docs tree
for a library-loading API returns nothing — the only "programmatic" references
are about consuming `varlock load --format json-full` from a subprocess. The
framework integrations do exactly that: they shell out to the CLI.

The documented paths are three:

1. `varlock run -- <command>` — resolve, validate, then spawn the child with
   values injected.
2. `import 'varlock/auto-load'` — "uses `execSync` to call out to the varlock
   CLI, sets resolved env vars into `process.env`, and initializes varlock's
   runtime code". On failure it writes to stderr and calls `process.exit`.
3. A framework plugin (Vite, Next.js, Astro, Cloudflare), which wraps path 2.

Source: [JavaScript integration](https://varlock.dev/integrations/javascript/).

Decision 2 asks for a factory that takes a source object. Decision 10 asks for
`loadSource({ cwd })` returning a plain object. Varlock offers neither, and its
architecture is built on not offering them: resolution happens once, in a
process varlock controls, so that redaction and leak detection can be installed
before application code runs.

### Module format and foreign loaders

`varlock@1.16.1` sets `"type": "module"`. Only `./init-server` and `./init-edge`
carry `.cjs` builds. `./`, `./env`, `./auto-load`, and `./config` are ESM with
no `require` condition.

**Measured, Node 24.** `require()` of `varlock/auto-load`, `varlock/env`,
`varlock`, and `varlock/init-server` all succeed. Node 22.12+ can `require()` an
ESM module with no top-level await, and varlock's entry points qualify. The
`init-server`/`init-edge` `.cjs` builds exist for bundler and edge targets, not
because plain CJS needs them.

That removes the naive "ESM-only breaks CJS" objection. It does not remove the
real one.
[ADR-0012](../adr/0012-the-medusa-backend-is-a-tsc-island.md) records that
Medusa loads every `.ts` file — config included — through a synchronous
`require()` that **ts-node 10.9.2 intercepts and refuses for ESM**. The failure
is inside ts-node, not Node. So `import 'varlock/auto-load'` inside
`medusa-config.ts` is the one shape that would not work, and it is the shape the
JavaScript integration recommends.

The workaround is also the point: under `varlock run -- medusa develop`,
`medusa-config.ts` imports nothing from varlock. It reads `process.env` and the
values are already there. Same for `drizzle.config.ts`. The
`ERR_REQUIRE_ESM` problem disappears because the library is never imported.

Decision 6 asks for a `development` export condition plus a dual ESM+CJS `dist`
build of `packages/env`. Under varlock the question changes shape rather than
being answered: there is no `packages/env` build to ship, because the contract
is a text file and the values arrive in `process.env`.

### Bun

`engines` declares `"bun": ">=1.3.3"`. This repository pins Bun 1.3.14.

**Measured.** `bun -e "import 'varlock/auto-load'; import { ENV } from
'varlock/env'"` resolves and prints correctly under Bun 1.3.14. `varlock run --
node ...` injects into the child and sets the `__VARLOCK_ENV` blob.

One documented conflict: Bun does its own `.env` loading based on `NODE_ENV`,
which "causes problems when bun decides to load `.env.development` and passes
those env vars into varlock". The fix is `env = false` in `bunfig.toml`, or
`--no-env-file` per invocation. This repository has no `bunfig.toml` today, so
adopting varlock adds one.

The docs are **silent on bun workspaces specifically**. The `dotenv` override
recipe in the migration guide covers npm, yarn, and pnpm only — Bun is not
listed.

Sources: [Bun integration](https://varlock.dev/integrations/bun/),
[Migrate from dotenv](https://varlock.dev/guides/migrate-from-dotenv/).

### Monorepo composition

This is decision 7 and decision 8, and varlock handles them well.

`@import()` composes schemas across packages, with `pick=[...]` allowlists,
`omit=[...]` denylists, glob support, `enabled=` conditions, and
`allowMissing=true`. Filters intersect across a chain: a key must pass every
filter between its definition and the importing file. Cycles fail with an error
naming the chain.

**Measured**, with a layout matching decisions 7 and 8:

```env-spec title="packages/env/.env.schema"
# @defaultSensitive=false @defaultRequired=infer
# ---
# @required @type=string(minLength=1)
DATABASE_URL=postgresql://postgres:password@localhost:5432/mze-store
# @required @type=string(minLength=1)
REDIS_URL=redis://localhost:6379
# @required @sensitive @type=string(startsWith=sk_) @example=sk_test_xxx
STRIPE_API_KEY=
```

```env-spec title="apps/medusa/.env.schema"
# @import(../../packages/env/.env.schema, pick=[DATABASE_URL, REDIS_URL, STRIPE_API_KEY])
# @defaultSensitive=false @defaultRequired=infer
# ---
# @required @sensitive
JWT_SECRET=
# @required @sensitive
COOKIE_SECRET=
PORTLESS_URL=
# @required
STORE_CORS=if(not(isEmpty($PORTLESS_URL)), "/^https://(?:[a-z0-9-]+\.)?storefront\.mze-store\.localhost$/", http://localhost:3001)
```

Running `varlock load` from `apps/medusa` resolves the imported items and the
local ones together, validates them as one graph, and reports failures per item.

Two frictions, both real but small:

- **Central declaration is supported but discouraged.** The
  [Monorepos guide](https://varlock.dev/guides/monorepos/) opens with "The
  recommended pattern is **one `.env.schema` per project**" and "Avoid funneling
  every variable into a single central env directory". Decision 8 says the
  opposite. Varlock does not stop you; the guide's own "Sharing config from the
  root or siblings" section is exactly the shape used above. But this repository
  would be going against the documented grain.
- **One `varlock/env` module per TypeScript program.** Global type augmentation
  from several schemas merges, so a package can see keys it never declared. The
  fix is documented: `@generateTsTypes(path=./env.ts, exposeEnv=local)`, which
  emits a package-local typed `ENV` and turns global augmentation off. Requires
  a `.ts` output path.

### Vite and the browser seam

`@varlock/vite-integration@1.4.0`, MIT, zero dependencies, 231,521 bytes across
5 files, peers on `varlock ^1.14.0` and `vite >=5`. Published 2026-07-28.

The plugin loads and validates through varlock, injects into `process.env` at
dev and build time, makes env vars available inside `vite.config.*`, replaces
`ENV.xxx` for non-sensitive items at build time with no prefix required, and
injects init code into SSR entry points.

TanStack Start has no dedicated package. The docs route it to the Vite
integration for Node, Vercel, Netlify, and self-hosted, and to the Cloudflare
integration for Workers.

On prefixes, varlock decouples secrecy from naming. `import.meta.env`
replacements still cover only `VITE_`-prefixed items, while `ENV` replacements
cover every non-sensitive item. A project that wants to keep the prefix
convention sets `@defaultSensitive=inferFromPrefix('VITE_')`.

Decision 3 asks for a cheap seam for a future browser contract. Varlock is
better than the zod plan here: the seam is a decorator on the item, and the
`PublicTypedEnvSchema` interface in the generated types is the browser half,
free.

Two unknowns. Vite's own `envDir` option is explicitly not supported — varlock
warns and ignores it, and you use `varlock.loadPath` in `package.json` instead.
And the sources are **silent on Vite+ / `vite-plus`**, which is what this
repository actually runs. `vite-plus` is aliased over `vite` through a root
`overrides` entry; whether a plugin peered on `vite >=5` behaves identically
there is untested and undocumented.

Sources: [Vite integration](https://varlock.dev/integrations/vite/),
[TanStack Start integration](https://varlock.dev/integrations/tanstack-start/).

### Docker builds and CI with no secrets

There is **no `SKIP_ENV_VALIDATION` equivalent**. A search of the docs for a
skip flag returns nothing, and the reserved-variable reference lists no such
switch.

Two mechanisms replace it, and both are better than a skip flag.

**Conditional requirement.** `@required` accepts a resolver, so requirement can
depend on the environment:

```env-spec
# @required=forEnv(production) @sensitive
STRIPE_API_KEY=
```

**Measured.** With `APP_ENV=development` this validates with `STRIPE_API_KEY`
absent. With `APP_ENV=production` it fails naming the key. The generated type
is `STRIPE_API_KEY?: string`.

That last line is the important one. **The type is honest.** It says optional
because the schema admits environments where the value is absent. No cast, no
`as any`. This is the "narrow, don't skip" shape the previous research told us
to build by hand, and varlock gets there without the hand-written part.

**Filtering.** Since 1.14.0, decorator-based filters scope resolution and
validation, "so e.g. a build-time `--filter='!@dynamic'` skips runtime-only vars
entirely, including their `@required` checks"
([CHANGELOG 1.14.0](https://github.com/dmno-dev/varlock/blob/main/packages/varlock/CHANGELOG.md),
PR #750).

**Measured.** With `@defaultDynamic=inferFromSensitive`, `varlock load
--filter='!@dynamic'` exits 0 while required sensitive items are missing, and
validates the static ones normally. `_VARLOCK_FILTER` sets the same thing
without a flag.

The filter path does **not** narrow the generated types — code generation is
documented as deterministic regardless of the active environment. So the honest
typing comes from `@required=forEnv(...)`, not from `--filter`. Use the first
for the contract and the second as a build-stage optimisation.

For containers, the Docker guide is unusually direct about _not_ shipping the
CLI: use it for CI validation only when the platform injects env vars, use
`varlock run` as `ENTRYPOINT` only when the container must resolve secrets at
boot. It also documents `varlock flatten`, which collapses the `@import` graph
into a self-contained directory so a single package can be built with a partial
Docker context. That command exists precisely because monorepo imports break
narrow build contexts — which is what this repository's Dockerfiles have.

Source: [Docker integration](https://varlock.dev/integrations/docker/),
[`varlock flatten`](https://varlock.dev/reference/cli/project/#flatten).

### How many processes need wrapping

The previous research said varlock "puts a CLI in front of every process". That
is directionally right, and the count is worth having.

Commands in this repository that read validated environment values today:

| Where             | Command                                       | Needs `varlock run`?                   |
| ----------------- | --------------------------------------------- | -------------------------------------- |
| `apps/medusa`     | `medusa build` (build, check-types)           | Yes                                    |
| `apps/medusa`     | `medusa develop` (dev:raw)                    | Yes — inside `portless run`            |
| `apps/medusa`     | `medusa start`                                | Yes, or `ENTRYPOINT`                   |
| `apps/medusa`     | `medusa db:migrate`, `db:rollback`            | Yes                                    |
| `apps/medusa`     | `medusa exec` seed, seed:probe                | Yes                                    |
| `apps/medusa`     | `medusa user` (operator:create)               | Yes                                    |
| `apps/medusa`     | `jest` integration tests                      | Yes                                    |
| `apps/storefront` | `vp dev`, `vp build`, `vp preview`            | No — Vite plugin                       |
| `packages/db`     | `drizzle-kit` push, generate, studio, migrate | Yes, four commands                     |
| `packages/env`    | `vp test`                                     | Not applicable — the package goes away |
| root              | `mze` Effect CLI                              | Yes for the subcommands that read env  |
| root              | `playwright`                                  | Yes                                    |

That is roughly **fourteen entry points**, of which the storefront's three come
free through the plugin.

What breaks if a process starts without the wrapper depends on which path you
pick. Under `varlock run` only, an unwrapped process sees whatever `.env` the
shell happened to provide and validates nothing — a silent failure, worse than
today's loud one. Under `varlock/auto-load` imported by application code, an
unwrapped process still validates, because auto-load spawns the CLI itself. The
robust design uses auto-load where the code is yours and `varlock run` where it
is not — which is what the Vite integration's `ssrInjectMode` options encode.

The auto-load path is not free. **Measured:** `varlock load --format json` takes
0.63–0.65 s wall clock across five runs on this machine. That is the per-process
cost of resolution. Since 1.16.0 a child under `varlock run` reuses the parent's
`__VARLOCK_ENV` blob instead of re-resolving, when the resolution directory
matches and nothing changed, so nesting does not multiply the cost.

Installed size is 8.3 MB in `node_modules` — 8,167,966 bytes unpacked across 212
files, because platform binaries for local encryption ship in the package. Zero
npm dependencies.

### Coexisting with plain `process.env`

Yes, by default. Varlock injects resolved values into `process.env`, so
third-party code that reads `process.env.DATABASE_URL` keeps working — the docs
call this out for the Node integration ("🆗 still works"). Only
`@disableProcessEnvInjection` turns that off, and the docs warn that when it is
set "any code that reads from `process.env` directly (including third-party
libraries) will not see varlock-resolved values".

Varlock does demand exclusive ownership of one thing: **the `.env` files
themselves.** The installation guide says to remove your existing
`.env.example`, and `varlock init` converts it into `.env.schema`. A file
varlock loads is a file varlock parses with `@env-spec` rules, which differ from
plain dotenv in documented ways.

## Maturity and risk

**Version 1.16.1, published 2026-08-08.** MIT. Zero runtime dependencies.
8,167,966 bytes unpacked across 212 files. `engines`: Node `>=22.3.0`, Bun
`>=1.3.3`.

**Release history.** 70 published versions. First release `0.0.0` on 2025-03-31.
`1.0.0` on 2026-04-29. Sixteen further releases in the fourteen weeks since,
roughly weekly: 1.1.0 (05-02) through 1.16.1 (08-08).

**Repository.** `dmno-dev/varlock`, created 2025-04-11, last push 2026-08-14.
4,166 stars, 112 forks. MIT. Not archived.

**Issue tracker.** 31 open issues and 22 open pull requests — the "53 open
issues" figure in the previous research counted both. 174 issues closed.
Maintainers respond, and quickly. Recent bug reports and their time to close:
#1009 and #1010 same day, #1002 in 0.4 days, #998 in 1.8, #983 in 2.3, #978 in
3.8, #942 in 10.8. The nine most recent open issues are mostly feature requests,
and eight of nine already carry a maintainer reply. Only one open bug (#897) has
no comments.

**Stability.** The 1.0.0 release is described in the project's own April 2026
recap as bringing "stronger config behavior guarantees and broader stability
work across the stack". Beyond that, **the sources are silent** on a formal
stability or breaking-change policy. There is no SemVer statement, no support
window, and no deprecation policy in the docs. The observed practice is
reasonable: deprecated features (`@envFlag`, `@docsUrl`, `@generateTypes`,
positional `@import` keys, the `regex()` wrapper) keep working and warn.

**Relationship to dmno.** The `dmno` README carries a maintainer notice:

> **Maintenance mode:** DMNO receives critical bug and security fixes only. For
> a suitable replacement, see [Varlock](https://varlock.dev).

Source:
[`dmno-dev/dmno` README](https://github.com/dmno-dev/dmno/blob/main/README.md).

The last `dmno` release is 0.0.41 on 2025-12-01. The repository is not archived;
its last push is 2026-06-10. dmno has 306 stars against varlock's 4,166, so
"varlock inherited dmno's users" understates it — varlock is thirteen times
larger than the project it replaces. The docs give the reasoning directly: "We
previously created DMNO and saw immense value in this schema-driven approach to
configuration. With env-spec, we wanted to provide a standard that could benefit
anyone who uses .env files."

**Telemetry is on by default.** The CLI collects anonymous usage data —
command name, integration and plugin names and versions, schema feature signals,
error category, versions, package manager, system information, and an anonymous
user and project ID. It never collects config files or values. Opt out with
`varlock telemetry disable`, `VARLOCK_TELEMETRY_DISABLED`, or `DO_NOT_TRACK`.
For a tool that would sit in front of every process in this repository and in
CI, this needs a deliberate decision rather than a default.

Source: [Telemetry guide](https://varlock.dev/guides/telemetry/).

### Limitations the maintainers document

- `@import()` supports local `.env` files only. HTTP and package-registry
  imports are marked "coming soon" and commented out of the published guide.
- Absolute Windows paths and backslash separators are not supported as import
  paths anywhere.
- `@setValuesBulk(createMissing=true)` items never reach generated types,
  because generation runs before values are fetched. The reference calls
  `createMissing=true` "not recommended" for this reason.
- Dynamic `@type` expressions must not change the generated type. Switching
  between `number` and `string` is a schema error.
- A dynamic `enum` types as a plain string in generated code, because membership
  is only known at resolution time.
- `@redactLogs` and `@preventLeaks` carry a documented performance cost.
- `@internal` items still resolve, so marking a variable internal produces no
  error if the application actually reads it — the value is simply missing.
- Vite's `envDir` is ignored.
- The credential proxy is labelled preview, and "on its own the proxy is
  same-uid and raises the bar rather than being a boundary".

### One behaviour that does not match its documentation

**Measured, and reproducible.** The
[`@defaultRequired` reference](https://varlock.dev/reference/root-decorators/#defaultrequired)
states that `infer` is the default, under which "items with an empty string or
no value are optional". With the decorator omitted, `varlock@1.16.1` treats an
item with no value as **required**:

```env-spec title=".env.schema"
BAZ=
FOO=bar
```

`varlock load` fails with `BAZ* — Value is required but is currently empty`.
Writing `# @defaultRequired=infer` explicitly in the header makes the same file
pass with `BAZ` optional.

This is either a documentation error or a regression. Either way it means the
schema header must state `@defaultRequired` explicitly rather than rely on the
documented default — a small thing, and a reminder that a fourteen-week-old 1.0
on a weekly release cadence has surface area that has not settled.

## The twelve decisions, one at a time

**1. The env package owns declaration and generates `.env.template`. Conflicts.**
Varlock inverts this. The committed `.env.schema` _is_ the template — it carries
the keys, the comments, the defaults, and `@example` values. `varlock init`
converts `.env.example` into `.env.schema`, and the installation guide instructs
you to delete the `.env.example` afterwards. There is no command that emits a
`.env.template` from a schema. The declaration ownership survives; the
generation step does not exist because the artifact it produced is gone.

**2. Factories taking an explicit source object. Conflicts.** No such API. See
[Is there a programmatic API?](#is-there-a-programmatic-api).

**3. Cheap browser seam. Fits, better than the plan.** `@sensitive` /
`@public` per item, `@defaultSensitive=inferFromPrefix('VITE_')` if the prefix
convention is preferred, `PublicTypedEnvSchema` in the generated types, and a
Vite plugin that already knows the difference.

**4. Portless overlay as an explicit named overlay. Fits with work.** The
rewrite works and is shown above. What is lost is the shape decision 4 asks
for. Today
[`apps/medusa/src/portless.ts`](../../apps/medusa/src/portless.ts) exports
`withPortlessCors(source)`, a named function the caller composes, and
`medusa-config.ts` reads `parse(withPortlessCors(process.env))`. Under varlock
the overlay becomes an `if(...)` expression inside the schema, applied by the
loader. That is exactly the "hidden inside loading" placement decision 4
rejects. The three-part condition (`PORTLESS_URL` set, `CI` unset, `NODE_ENV`
development or unset) is expressible — `and()` does not exist, but nested
`if()`/`ifs()` covers it — at the cost of readability.

**5. One honestly typed skip mechanism that still applies defaults. Fits, and
solves the harder half.** `@required=forEnv(...)` gives conditional requirement
with an honest `?` in the generated type. Defaults in the schema always apply,
because they are values in the file, not a library feature. `--filter='!@dynamic'`
gives a build-stage narrowing on top. This is the one place where varlock
delivers what the previous research said no library delivers.

**6. `development` condition plus dual ESM+CJS `dist`. Fits with work.** The
question dissolves for consumers reached by `varlock run`. It does not dissolve
for `medusa-config.ts` if you want the `ENV` object there, because ts-node
10.9.2 refuses ESM (ADR-0012). Design the migration so Medusa never imports
varlock.

**7. Fragments composed into contracts. Fits.** `@import()` with `pick` and
`omit` is a better composition primitive than `extends` in either t3-env or
envin, because it composes _declarations_ and validates once.

**8. Fragments live centrally in `packages/env`. Fits with work.** Supported and
demonstrated, but the Monorepos guide recommends the opposite layout.

**9. Producer side shares one URL definition. Fits, clearly better.**
Demonstrated above. `services.ts` shrinks to port discovery.

**10. `loadSource({ cwd })` returns a plain object. Conflicts.** The closest
thing is `varlock load --format json` from a subprocess, which returns a flat
`{ KEY: value }` map on stdout — an object across a process boundary, at ~640 ms
and with no types.

**11. Templates generated, CI fails on diff; `.env.test` hand-written.**
Conflicts on the first half; the second half fits well. There is no template to
diff, and therefore no CI job. `.env.test` maps cleanly onto varlock's
`.env.[currentEnv]` convention with `@currentEnv` pointed at an `APP_ENV` flag,
and stays hand-written.

**12. Custom failure report grouped by fragment. Conflicts.** Varlock owns the
report, and it is good — per-item, colourised, with the failing dependency
chain named, `varlock explain <KEY>` for a single item's full resolution
history, and `--show-all` for context. It is not grouped by fragment, it does
not name the exact `.env` file to fix as a copyable line, and there is no
documented hook to replace or extend it. What you can build is a wrapper that
parses `varlock load --format json-full` and reprints it — which means running
resolution twice, or wrapping the wrapper.

## What would have to be reopened

Blunt version, for the person who has to decide.

**Abandon outright:**

- **Decision 2.** No factory takes a source object. This is not a gap to fill;
  it is varlock's architecture pointing the other way.
- **Decision 10.** No `loadSource`. Same reason.
- **Decision 12.** The failure report belongs to varlock.

**Reopen and re-answer:**

- **Decision 1**, first half stays (declaration is owned centrally), second half
  is deleted (nothing generates `.env.template`, because `.env.template` stops
  existing).
- **Decision 11**, first half deleted with it, including the CI diff job.
- **Decision 4**, the "explicit named overlay the caller composes" constraint.
  Under varlock the overlay is a schema expression the loader applies. You get
  the behaviour and lose the seam.
- **Decision 8**, not because varlock forbids central fragments, but because you
  would be running against the documented recommendation and should say so in
  the ADR.

**Survive unchanged or improve:** 3, 5, 7, 9. Decisions 5 and 9 improve
materially.

**Also new, and not on the list:**

- `packages/env` ceases to be a TypeScript package. It becomes a directory
  holding `.env.schema` fragments.
- Every one of the ~14 entry points above gains a `varlock run --` prefix or an
  auto-load import.
- A `bunfig.toml` with `env = false` appears, to stop Bun's own `.env` loading
  from feeding varlock.
- A telemetry decision has to be made and recorded.
- `varlock` becomes a hard dependency of local development, CI, and both
  Dockerfiles, pinned exactly.

## Migration sketch

Only useful for judging the size of the change. Not a plan.

### `packages/env/`

```text
packages/env/
  .env.schema          # shared fragments: postgres parts, redis, stripe, betterAuth, runtime
  package.json         # keeps the workspace name; no src/, no dist/, no vite.config.ts
```

No `src/`, no build, no `dist`, no dual format, no `alwaysBundle` workaround.
`vite.config.ts` and `test/package-exports.test.ts` are deleted — the tests
assert things (`dist/*.mjs` vs `dist/*.cjs` resolution) that no longer exist.
The `@t3-oss/env-core`, `zod`, and `dotenv` dependencies all go.

### `apps/medusa/medusa-config.ts`

Loses three imports and gains nothing:

```ts
import { defineConfig } from "@medusajs/framework/utils";
// loadEnv, parse, withPortlessCors all gone

export default defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL!,
    redisUrl: process.env.REDIS_URL!,
    http: { storeCors: process.env.STORE_CORS! /* ... */ },
  },
  // ...
});
```

Note the four `!` assertions. `@generateTsTypes` augments `NodeJS.ProcessEnv`,
so with the generated `env.d.ts` in the Medusa `tsconfig` include path the
assertions come off and the values type as `string`. That only works if the
declaration file reaches a `tsc` island that ADR-0012 keeps deliberately
separate. Untested.

`apps/medusa/src/portless.ts` is deleted. Its CORS patterns move into
`apps/medusa/.env.schema` as `if()` expressions.

Scripts change from `SKIP_ENV_VALIDATION=1 medusa build` to
`varlock run --filter='!@dynamic' -- medusa build`.

### `packages/db/drizzle.config.ts`

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema",
  out: "./src/migrations",
  dialect: "postgresql",
  schemaFilter: ["auth"],
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

The `dotenv.config({ path: "../../apps/storefront/.env" })` call goes away,
replaced by `@import(../../apps/storefront/)` in `packages/db/.env.schema` or by
`varlock.loadPath` in `packages/db/package.json`. All four `drizzle-kit` scripts
gain `varlock run --`.

### `packages/auth/src/instance.ts`

```ts
import { ENV } from "varlock/env";

export function getAuth() {
  auth ??= createAuth({
    database: createDb(ENV.DATABASE_URL),
    secret: ENV.BETTER_AUTH_SECRET,
    baseURL: ENV.BETTER_AUTH_URL,
    trustedOrigins: [ENV.CORS_ORIGIN],
  });
  return auth;
}
```

Nearly identical shape. The Portless rewrite that `packages/env/src/server.ts`
performs today moves into the schema, so `BETTER_AUTH_URL` and `CORS_ORIGIN`
arrive already rewritten. This is the cleanest part of the migration.

### `tooling/mze/services.ts`

`Services.start` stops building URL strings and returns discovered ports:

```ts
return {
  DB_HOST: "localhost",
  DB_PORT: String(discovered.postgres),
  DB_USERNAME: "postgres",
  DB_PASSWORD: password,
  POSTGRES_PASSWORD: password,
  REDIS_PORT: String(discovered.redis),
} satisfies Environment;
```

`DATABASE_URL` and `REDIS_URL` disappear from the `Environment` interface. The
schema composes them from the parts, and the composed values reach child
processes through `varlock run`. This removes a genuine duplication the current
design has, and is the single strongest argument in varlock's favour for this
repository.

### Dockerfiles

Both need the varlock binary in the builder stage, and `apps/medusa` needs it in
the runtime stage if secrets resolve at boot. Both need `varlock flatten` in the
builder, because `@import()` across `packages/env` reaches outside the build
context. `apps/storefront/Dockerfile` loses `ENV SKIP_ENV_VALIDATION=1`.

### CI

`.github/workflows/release.yml` gains no template-diff job (there is no
template) and gains `varlock load` as a schema validation step. The GitHub
Action `@varlock/varlock-github-action` exists; this evaluation did not check
it.

## The hybrid option

**Varlock for the schema and template, zod for programmatic validation, is
credible — and there are two shapes of it.**

**Shape A: plugin-generated zod.** Code generation runs through a registry that
plugins can extend, and the documented example is _literally_ a zod generator:

```ts title="my-plugin.ts"
import { plugin, type CodeGeneratorDef } from "varlock/plugin-lib";

const generateZodSchema: CodeGeneratorDef = {
  decoratorName: "generateZodSchema",
  generate: ({ fields, outputPath }) => {
    const lines = fields.map((f) => `  ${f.key}: z.string(),`);
    return `import { z } from 'zod';\n\nexport const envSchema = z.object({\n${lines.join("\n")}\n});\n`;
  },
};

plugin.registerCodeGenerator(generateZodSchema);
```

Source: [Code generation guide](https://varlock.dev/guides/code-generation/).

`fields` carries keys, coerced and raw types, required and sensitive flags, and
docs. That is enough to emit real zod fragments, not just `z.string()`. The
schema stays the single declaration (decision 1), a generated
`packages/env/src/generated.ts` holds zod object schemas, and every consumer
keeps calling `parse(source)` exactly as today. Decisions 2, 10, and 12 survive
untouched, because zod is still doing the validating.

The cost: you write and maintain a varlock plugin, and you run `varlock codegen`
in CI with a diff check — which is the same CI job decision 11 already asks for,
pointed at a different file. `@required=forEnv()` does not translate to zod
without a convention, and derived `if()` values would have to be excluded from
the generated schema, since zod cannot compute them.

**Shape B: schema as documentation only.** Keep `.env.schema` committed as the
human-and-agent-readable contract and the replacement for `.env.template`. Do
not run varlock in any process. Write zod by hand as today. Add one CI step:
`varlock load` to prove the schema and the real environment agree, plus
`varlock scan` as a pre-commit hook. Zero runtime coupling, zero process
wrapping, zero telemetry in production paths, ~8 MB dev dependency.

Shape B costs almost nothing and buys the leak scanner and an agent-readable
schema. It also buys nothing that solves decision 1 properly, because now there
are two declarations to keep in sync — the schema and the zod fragments — which
is the problem decision 1 exists to prevent. Shape A fixes that at the cost of
owning a plugin.

They are **not** mutually exclusive with zod in any technical sense. Varlock
does not implement Standard Schema, does not consume zod schemas, and has no
plans to that the sources mention — but nothing stops the same repository from
running both, because they meet at generated code and at `process.env`.

## Recommendation

**Keep plain zod v4. Revisit varlock when the requirement changes, or take
Shape B of the hybrid now if the leak scanner is wanted.**

### The strongest case for adopting varlock

Three of the twelve decisions exist because no library solved a problem, and
varlock solves all three properly.

Decision 5 asked for a skip mechanism that stays honestly typed. Every library
in the previous comparison lied with `as any`, and `packages/env/src/medusa.ts`
copies the lie today. The plan was to hand-build a derived build-time schema.
Varlock ships the answer: `@required=forEnv(production)` produces
`STRIPE_API_KEY?: string` in generated types and enforces the requirement only
where it applies. Nothing to build, no cast, no drift between the narrowed
schema and the full one.

Decision 9 asked the producer and the validator to share one definition of a
connection URL. Today `tooling/mze/services.ts` writes
`postgresql://postgres:${encodedPassword}@127.0.0.1:${discovered.postgres}/mze-store?sslmode=disable`
in TypeScript, and `packages/env/src/schemas.ts` validates it with
`z.string().min(1)` — which is to say, it does not validate it at all. Under
varlock one line in one file composes it from parts, `services.ts` supplies two
port numbers, and the parts each get a type.

Decision 1 asked the env package to generate templates so they cannot drift.
Varlock removes the drift by removing the second artifact. One committed file is
the contract, the documentation, the defaults, and the thing a new developer
copies from. Decision 11's CI diff job exists only because two files can
disagree.

And beyond the twelve: an agent-readable schema, `varlock scan` as a pre-commit
gate, log redaction, leak detection on outgoing responses, and a path to
1Password or AWS secrets that this repository will eventually want, since it
handles Stripe keys and will handle more. The project is healthy — weekly
releases, same-week bug fixes, 4,166 stars, MIT, zero dependencies, and the
maintainers' previous tool formally pointed here.

### The strongest case against

The costs are not features. They are shape.

**You cannot call it.** Decisions 2 and 10 are not preferences this repository
adopted casually. They came from a specific failure: Medusa's loader and
drizzle-kit both supply their own source, and a module that reads `process.env`
at import time cannot serve them. That is why two of three entrypoints in
`packages/env` already call `schema.parse(source)` directly. Varlock's answer is
to own the process instead, which works, and which is a different program. There
is no incremental path — you cannot adopt varlock for the Portless overlay and
keep `parse(source)` for everything else, because varlock has no `parse(source)`.

**You cannot own the error message.** Decision 12 asked for a report grouped by
fragment, naming the `.env` file and the line to copy. Varlock's report is good
and it is varlock's. Every failure a developer sees is worded by a dependency.

**The cost lands on fourteen entry points, permanently.** Every Medusa command,
every drizzle-kit command, jest, playwright, and the `mze` CLI gain a wrapper or
an import. ~640 ms of resolution per unwrapped process. A process that skips the
wrapper fails silently rather than loudly. A global `console` patch sits between
`tooling/mze`'s JSON output and stdout. A `bunfig.toml` appears to stop Bun
fighting varlock over `.env` files. Two Dockerfiles gain a binary and a
`flatten` step. Telemetry defaults on.

**And the payoff is for a problem this repository does not have yet.** The
secret-management half — plugins, the credential proxy, encrypted deployments,
OIDC — is where varlock's weight is, and none of it is needed today. What is
needed is typed access to eight variables across three consumers, and plain zod
does that in 20 lines with no process boundary.

`@t3-oss/env-core` is the wrong dependency and should go; that conclusion is
unchanged. Replacing it with a CLI that owns every process is a much larger
correction than the problem calls for.

### When to revisit

- When secrets move out of `.env` files into 1Password, AWS, or Vault. That is
  varlock's actual subject and nothing else on the list competes.
- When the Storefront gains browser-visible variables _and_ a leak becomes a
  real risk. `varlock scan` plus `@sensitive` is stronger than a prefix
  convention.
- When the schema fragment count outgrows what `schemas.ts` reads well, and
  `@import(..., pick=[...])` starts looking like the better composition
  primitive. It is.

Take now, at near-zero cost, if wanted: `varlock scan --install-hook` as a
pre-commit secret scanner, with no schema and no runtime coupling. That is
Shape B without even the schema file.
