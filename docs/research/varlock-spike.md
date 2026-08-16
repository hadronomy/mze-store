# Varlock spike: four proofs

## Question

Three pieces of this repository's infrastructure are undocumented by varlock, and
one design decision has no documented answer. The env package redesign cannot
start until all four are settled, because the answers decide which of two
different packages gets built.

The spike ran in a throwaway git worktree at `/tmp/mze-varlock-spike`, detached at
`aff473c`. The code is disposable. These answers are the artifact.

Versions under test: `varlock@1.16.1`, `@varlock/vite-integration@1.4.0`,
`bun@1.3.14`, `vite-plus@0.2.6`, node 24.18.1.

## Verdict

| # | Proof | Requirement | Result |
|---|-------|-------------|--------|
| 1 | bun workspaces | hard | **PASS** |
| 2 | vite-plus | hard | **PASS** |
| 3 | drizzle-kit | hard | **PASS** |
| 4 | in-process validation, public exports only | soft | **FAIL** |

All three hard proofs pass. **Adopt varlock.** Proof 4 fails, and its cost is
recorded below.

## Proof 1 — bun workspaces

A root `.env.schema` holds the shared resource fragments. `apps/medusa/.env.schema`
pulls them in with `@import(../../)`.

Run from `apps/medusa`, `varlock load --agent` returned all eight items — the six
declared locally plus `DATABASE_URL` and `REDIS_URL` from the root file. Sensitive
items came back masked without any extra flag:

```
"STRIPE_API_KEY": "sk▒▒▒▒▒",
"DATABASE_URL": "postgresql://postgres:password@localhost:5432/mze-store?sslmode=disable",
```

Bun 1.3.14 installs with an isolated linker — the root `node_modules` holds 18
direct dependencies and everything else lives under `node_modules/.bun` with
symlinks into each workspace. Varlock resolves correctly under that layout.

### Varlock does not search upward

Run from `packages/db` with no local schema, varlock stops:

```
🚨 No .env files found in /private/tmp/mze-varlock-spike/packages/db
```

Every directory that runs a varlock command needs its own `.env.schema`, or an
explicit `--path`. Both work. A local file with `@import(../../)` resolves, and so
does a central file addressed from elsewhere:

```
varlock run --path ../../packages/env/contracts/drizzle.env.schema -- <cmd>
```

This bears on Q9. Central contracts stay possible, at the cost of a `--path` flag
on every command that uses one.

## Proof 2 — vite-plus

The concern was `@varlock/vite-integration`'s peer range `vite >=5` against this
repo's `overrides` entry mapping `vite` to `@voidzero-dev/vite-plus-core@0.2.6`.

Bun resolved it with no peer error. The integration sees the override target:

```
apps/storefront/node_modules/vite ->
  ../../../node_modules/.bun/@voidzero-dev+vite-plus-core@0.2.6+.../node_modules/@voidzero-dev/vite-plus-core
```

The plugin bundle imports nothing from `vite` — only types from `varlock` — and
`varlockVitePlugin()` returns `any`, so the version mismatch has no surface to
fail on.

### Client/server separation holds

`apps/storefront/.env.schema` declared two marker values: a public
`VITE_PUBLIC_MARKER` and a `@sensitive` `BETTER_AUTH_SECRET`. The index route
reads the public one through `ENV` from `varlock/env`.

`vp build` succeeded. Searching the output:

| Marker | `.output/public` (client) | `.output/server` |
|--------|---------------------------|------------------|
| public | 1 file — `assets/routes-2rAqTlia.js` | — |
| secret | **0 files** | **0 files** |

The public value is inlined into the client bundle. The secret reaches neither
bundle; it resolves at run time.

`vp dev` also boots and serves HTTP 200. The rendered HTML contains the public
marker once and the secret zero times.

### `@defaultSensitive=true` over-redacts

The default marks every item sensitive. With `BETTER_AUTH_URL` covered by that
default, varlock masked the dev server's own address in the terminal:

```
➜  Local:   ht▒▒▒▒▒/
```

Schemas have to set `@defaultSensitive=false` at the file header and mark secrets
one by one, or ordinary terminal output becomes unreadable.

## Proof 3 — drizzle-kit

A spike config read `process.env.DATABASE_URL` with no `dotenv` call.

Control, without varlock:

```
[spike] drizzle config saw DATABASE_URL = undefined
[spike] DATABASE_URL absent
```

Under `varlock run`, with a distinctive port to prove the value travelled:

```
[spike] drizzle config saw DATABASE_URL = postgresql://postgres:password@127.0.0.1:59999/mze-store
Using 'pg' driver for database querying
[⣷] Pulling schema from database...
```

drizzle-kit received the resolved value and reached the connection attempt, which
fails only because nothing listens on 59999.

The control run is also the answer to the silent-failure worry for this consumer:
without varlock the config throws immediately. Silence is confined to processes
that supply their own fallback, which is Medusa's `loadEnv()` call at
`apps/medusa/medusa-config.ts:8`.

## Proof 4 — in-process validation (FAIL)

The public export surface of `varlock`, read at run time:

```
createDebug, getBuildTimeReplacements, internal, load,
patchGlobalConsole, patchGlobalResponse, patchGlobalServerResponse
```

`load()` has arity 0. No public callable accepts an environment source. Every
capability that could validate one — `loadEnvGraph`, `checkForConfigErrors`,
`EnvGraph`, the five error classes — sits behind `internal`.

The pre-agreed criterion in Q29 was that reaching for `internal` counts as a
failure. It does.

The internal route does work. `internal.loadEnvGraph({ entryFilePaths, overrideValues })`
loaded an 8-item graph in process with no spawn. It is undocumented, explicitly
namespaced as internal, and varlock publishes no stability policy.

### `varlock/test-helpers` is a broken export path

`package.json` declares `./test-helpers` pointing at `./src/test-helpers/plugin-test.ts`,
but the published `files` field is `["/bin", "/dist", "/native-bins", "/skills"]`.
`src/` is not in the tarball. Importing it throws `ERR_MODULE_NOT_FOUND`. Worth
reporting upstream.

### Cost

Contract tests either spawn a process, or use an unstable internal API. Q30 priced
this in advance as an accepted cost, recorded in the ADR.

## Findings that change settled decisions

**Q9 — central contracts.** Supported through `--path`, at the cost of a flag per
command. Varlock's own idiom is a schema per directory. Worth re-deciding.

**Q13 — the custom failure report.** Varlock's built-in report is already better
than the one planned. It names the item, marks required with `*`, flags sensitive,
shows the value's source, and redacts secrets inside the error:

```
❌ STRIPE_API_KEY*  🔐sensitive
   └ pk▒▒▒▒▒  🟡 process.env
   - Value must start with "sk_"
```

**Q18 — testing.** Proof 4 failed, so in-process contract tests need the internal
API or a spawn.

**Q28 — strict validation.** Confirmed workable. `@type=url` accepts
`postgresql://…?sslmode=disable`, and `@type=string(startsWith=sk_)` rejects a
wrong Stripe key. Exit codes are CI-safe: 1 on invalid, 0 on valid.

**Q33 — the CORS union.** The Portless regex form passes through unchanged as a
plain string. Accepting "origin or regex" per entry needs a custom type or a
matcher; nothing blocks it.

## Second pass: `exposeEnv=local`

The first pass missed `@generateTsTypes(path=./env.ts, exposeEnv=local)`. It
changes the design conclusion, so it was measured separately.

### The generated module is code, not declarations

With `exposeEnv=local`, varlock writes a real `.ts` module, not a `.d.ts`:

```ts
// @ts-nocheck
import { ENV as _ENV } from 'varlock/env';

export type CoercedEnvSchema = { STRIPE_API_KEY: string; JWT_SECRET: string; … };
export type PublicCoercedEnvSchema =
  Readonly<Pick<CoercedEnvSchema, 'STORE_CORS' | 'ADMIN_CORS' | 'AUTH_CORS' | 'DATABASE_URL' | 'REDIS_URL'>>;
export const ENV = _ENV as unknown as Readonly<CoercedEnvSchema>;
```

Each item carries its schema comment through as a doc comment. Sensitive items
are excluded from `PublicCoercedEnvSchema` automatically.

The `import` is a run-time import. The module is not erasable.

### The Medusa CJS island can load it

`varlock/env` is ESM only — varlock sets `"type": "module"` and ships no CJS
build for that path.

Measured, in order:

| Case | Result |
|------|--------|
| `require("varlock/env")` from `.cjs`, node 24.18.1 | works, 16 keys |
| same, inside `varlock run` | works |
| **ts-node 10.9.2, `module=commonjs`, importing the generated `env.ts`** | **works** |

```
[probe] ts-node read ENV.DATABASE_URL = postgresql://postgres:password@localhost:5432/mze-store?sslmode=disable
```

Node 24's `require(esm)` bridges the gap. ADR-0012's ts-node constraint does not
block `import { ENV } from "./env"` in `medusa-config.ts`.

### An unwrapped process fails loudly

Running the same probe without `varlock run`:

```
Error: varlock ENV not initialized — make sure varlock is set up correctly.
See https://varlock.dev/getting-started/installation/ for setup instructions.
```

Exit code 1. Reading through `ENV` rather than `process.env` turns a missed
wrapper into a crash at the first property access. The silent-failure risk
belongs to `process.env` reads alone.

### Consequences for the design

Three objections to the "delete the package" design are answered: `exposeEnv=local`
gives per-package types with no global `ProcessEnv` collision, `ENV` typed as
`string` removes the non-null assertions, and the CJS island works unchanged.

One coupling has no answer from varlock. `tooling/mze` discovers Docker ports at
run time and injects them by name. Nothing makes a renamed schema item fail the
CLI's typecheck.

## Unrelated observation

The storefront build fails unless `@mze-store/design-tokens` is built first —
`./theme.css` has no target otherwise. This predates the spike and has nothing to
do with varlock.

## Reproducing

The worktree is still on disk at `/tmp/mze-varlock-spike`, uncommitted. Remove it
with `git worktree remove --force /tmp/mze-varlock-spike`.
