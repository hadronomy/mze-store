# Typed environment variables: `@t3-oss/env-core` and the alternatives

**Date checked:** 2026-08-15

**Scope:** `packages/env` and its three consumers. Decide whether to keep
`@t3-oss/env-core@0.13.11` or replace it.

## Question

`packages/env` declares environment contracts for three consumers:

1. `apps/medusa` — a `tsc` island that emits CJS-compatible output. Medusa's own
   loader calls `loadEnv()` before validation runs, then the package injects
   derived CORS values before it validates.
2. `apps/storefront` — TanStack Start on Vite. No browser-visible variables
   today. It will need some later.
3. `packages/db/drizzle.config.ts` — drizzle-kit loads its own dotenv files
   first.

The package ships a dual ESM+CJS build with `dist/*.mjs` and `dist/*.cjs`
entrypoints for consumers 1 and 3.

Seven requirements drive the choice:

1. Composition of shared schema fragments across packages.
2. A factory that takes an explicit environment source as an argument, instead
   of reading `process.env` when the module loads.
3. A build-time skip-validation path that stays honestly typed.
4. Dual ESM + CJS distribution, and a library that CJS can consume.
5. Generation of a `.env` template from the schema.
6. Client/server split with a prefix convention, and a guard that keeps server
   secrets out of the client bundle.
7. Standard Schema support, so the validator can change later.

## Result

Drop `@t3-oss/env-core`. Move `packages/env` to plain zod v4 with a small
helper of its own.

The repository already made this decision in two of its three entrypoints.
`src/database.ts` and `src/medusa.ts` call `schema.parse(source)` directly.
Only `src/server.ts` calls `createEnv`. Requirement 2 is the reason: Medusa's
loader and drizzle-kit both supply their own source, and `createEnv` does not
fit an entrypoint that must inject derived values first. Two thirds of the
package has already left the library.

`@t3-oss/env-core` is the only ESM-only dependency that forces
`alwaysBundle: "@t3-oss/env-core"` in `packages/env/vite.config.ts`. Removing it
removes that workaround.

No library meets requirement 3. `@t3-oss/env-core` and `envin` both cast an
unvalidated object with `as any` on the skip path. The repository's
`src/medusa.ts` copies the same lie. Only a hand-written helper can tell the
truth here, because the truth is a different return type.

The runner-up is `envin`. Consider it only when the Storefront gains a browser
half and the team wants a ready-made client/server guard.

`varlock` is the strongest project of the six by activity and by feature
coverage. It answers a different question. Choose it when the problem becomes
secret management, not typed access.

## Comparison

| Candidate                                | 1 Compose | 2 Explicit source | 3 Honest skip | 4 ESM+CJS | 5 Template | 6 Client split | 7 Standard Schema |
| ---------------------------------------- | --------- | ----------------- | ------------- | --------- | ---------- | -------------- | ----------------- |
| `@t3-oss/env-core` 0.13.11               | Partial   | Yes               | No            | No        | No         | Yes            | Yes               |
| `envin` 1.2.0                            | Yes       | Yes               | Partial       | No        | No         | Yes            | Yes               |
| `znv` 0.5.0                              | No        | Yes               | No            | Yes       | No         | No             | No                |
| `varlock` 1.16.1                         | Yes       | No                | Partial       | Other     | Yes        | Yes            | No                |
| `@julr/vite-plugin-validate-env` 2.2.2   | No        | No                | No            | No        | No         | Partial        | Yes               |
| plain zod v4 + helper                    | Yes       | Yes               | Yes           | Yes       | Build it   | Build it       | Yes               |

"Other" for varlock requirement 4 means the question does not apply in the same
form. Varlock injects resolved values into `process.env` before the target
process starts, so the module format of the consumer does not matter.

## `@t3-oss/env-core`

**Version 0.13.11, published 2026-03-22.** MIT. Zero runtime dependencies.
132,977 bytes unpacked across 24 files. Peer dependencies are all optional:
`zod ^3.24.0 || ^4.0.0`, `valibot`, `arktype`, `typescript >=5.0.0`.

Release cadence over the past year is thin. Versions 0.13.1 to 0.13.8 shipped
between April and June 2025. Then a six-month gap. 0.13.9 and 0.13.10 shipped on
2025-12-15, and 0.13.11 on 2026-03-22. That is three release days in twelve
months.

Maintenance is slower than the release record suggests. The last commit on
`main` is 2026-04-01. The repository has 32 open issues and 8 open pull
requests. Three of those pull requests are bug fixes that nobody has reviewed:
[#413](https://github.com/t3-oss/t3-env/pull/413) since 2026-07-29,
[#411](https://github.com/t3-oss/t3-env/pull/411) since 2026-07-03, and
[#410](https://github.com/t3-oss/t3-env/pull/410) since 2026-05-03. The project
has 3,998 stars, so this is a popular library with a stalled queue.

### Requirement 1 — partial

`extends` composes environment objects, not schema fragments. The merge in
[`packages/core/src/index.ts:389`](https://github.com/t3-oss/t3-env/blob/main/packages/core/src/index.ts)
operates on values:

```ts
const extendedObj = (opts.extends ?? []).reduce((acc, curr) => {
```

Each preset must be a complete `createEnv` result. The bundled presets confirm
the shape — every one is a function that returns `createEnv(...)`:

```ts
export const vercel = (): Readonly<VercelEnv> =>
  createEnv({
    server: { VERCEL: z.string().optional(), /* ... */ },
```

Source: [`packages/core/src/presets-zod.ts`](https://github.com/t3-oss/t3-env/blob/main/packages/core/src/presets-zod.ts).

The documented monorepo pattern extends a built object from another package:

```ts
// apps/web/env.ts
import { env as authEnv } from "@repo/auth/env";

export const env = createEnv({
  // ...
  extends: [authEnv],
});
```

Source: [Customization — Extending presets](https://env.t3.gg/docs/customization).

This works. It does not match requirement 1. One place declaring `DATABASE_URL`
must declare it as a full environment object with its own `runtimeEnv`, and that
object validates when the fragment loads. The repository's current
`schemas.ts` exports a bare `databaseUrlSchema` and reuses it in two object
schemas. That is the shape requirement 1 asks for, and `extends` cannot express
it.

### Requirement 2 — yes

The source is an argument. `process.env` is only a fallback:

```ts
const runtimeEnv = opts.runtimeEnvStrict ?? opts.runtimeEnv ?? process.env;
```

Source: [`packages/core/src/index.ts:315`](https://github.com/t3-oss/t3-env/blob/main/packages/core/src/index.ts).

`runtimeEnvStrict` forces every declared key to appear in the object, which
suits bundlers that rewrite `process.env.X` statically.

### Requirement 3 — no

The skip path returns the unvalidated source under the validated type:

```ts
const skip = !!opts.skipValidation;
if (skip) {
  if (opts.extends) {
    for (const preset of opts.extends) {
      preset.skipValidation = true;
    }
  }
  return runtimeEnv as any;
}
```

Source: [`packages/core/src/index.ts:326-335`](https://github.com/t3-oss/t3-env/blob/main/packages/core/src/index.ts).

Two open issues record the consequences. Issue
[#266](https://github.com/t3-oss/t3-env/issues/266), open since 2024-09-12,
reports that schema defaults do not apply under `SKIP_ENV_VALIDATION`, so
variables are `undefined` where the type says `string`. Pull request
[#408](https://github.com/t3-oss/t3-env/pull/408), open since 2026-04-03,
reports that extended variables disappear under the same flag.

The documentation states the tradeoff but does not fix it. The Customization
page describes `skipValidation` as "Tell the library to skip validation if
condition is true."

### Requirement 4 — no

The package is ESM-only. `package.json` sets `"type": "module"`, and no export
condition carries a `require` branch:

```json
".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
```

The Core documentation confirms it is an "ESM-only package requiring `Bundler`
module resolution". Source: [Core](https://env.t3.gg/docs/core).

This is why `packages/env/vite.config.ts` sets
`deps: { alwaysBundle: "@t3-oss/env-core" }`. The CJS output works only because
the build inlines the library.

### Requirement 5 — no

There is no CLI and no `bin` field in the package manifest. The documentation is
silent on template generation. A search of the issue tracker returns no open or
closed request for it.

### Requirement 6 — yes

`clientPrefix` is enforced in the type system and at runtime. The type layer
rejects a client key without the prefix and rejects a server key with it:

```ts
[TKey in keyof TClient]: TKey extends `${TPrefix}${string}`
  ? ...
  : ErrorMessage<`${TKey extends string ? TKey : never} is not prefixed with ${TPrefix}.`>;
```

The runtime layer wraps the result in a `Proxy`:

```ts
const isServerAccess = (prop: string) => {
  if (!opts.clientPrefix) return true;
  return !prop.startsWith(opts.clientPrefix) && !(prop in _shared);
};
```

`isServer` defaults to `typeof window === "undefined" || "Deno" in window`, and
`onInvalidAccess` handles a violation. Source:
[`packages/core/src/index.ts`](https://github.com/t3-oss/t3-env/blob/main/packages/core/src/index.ts).

### Requirement 7 — yes

The library validates through the Standard Schema interface and vendors the
types rather than depending on `@standard-schema/spec`, which keeps the runtime
dependency count at zero:

```ts
const parsed = finalSchema?.["~standard"].validate(runtimeEnv) ??
  parseWithDictionary(finalSchemaShape, runtimeEnv);
```

Zod, Valibot, ArkType, and Typia all work. Source:
[Standard Schema](https://env.t3.gg/docs/standard-schema).

### Sharp edges

`emptyStringAsUndefined` mutates the object you pass:

```ts
const emptyStringAsUndefined = opts.emptyStringAsUndefined ?? false;
if (emptyStringAsUndefined) {
  for (const [key, value] of Object.entries(runtimeEnv)) {
    if (value === "") {
      delete runtimeEnv[key];
    }
  }
}
```

Source: [`packages/core/src/index.ts:317-324`](https://github.com/t3-oss/t3-env/blob/main/packages/core/src/index.ts).

Pull request [#411](https://github.com/t3-oss/t3-env/pull/411) documents the
effect: pass `process.env` and the keys leave the global object for the life of
the process. `packages/env/src/server.ts` sets `emptyStringAsUndefined: true`,
but it passes a spread copy — `const runtimeEnv = { ...process.env }`. The
repository avoids the bug today by accident, not by design.

## `envin`

**Version 1.2.0, published 2026-01-18.** MIT. Zero runtime dependencies. 81,619
bytes unpacked across 13 files. Same optional peer set as `@t3-oss/env-core`.

`envin` is a direct reimplementation of t3-env. Its own comparison page says it
"is highly inspired by t3-env" and "enhances the experience of t3-env by solving
most common issues reported by the community (e.g. about presets) and adding a
CLI with a live preview on top of it". Source:
[`apps/docs/content/docs/comparisons.mdx`](https://github.com/turbostarter/envin/blob/main/apps/docs/content/docs/comparisons.mdx).

The maintenance picture is mixed. The repository shows recent pushes — the last
is 2026-08-01 — but every commit since 2026-06-14 is a dependency bump. The last
core release is 1.2.0 from 2026-01-18, seven months back. The issue tracker
holds zero open issues, and every one of the ten most recent closed issues is a
Dependabot pull request. There are no user bug reports at all. At 112 stars,
read that as low adoption rather than high quality. Maintainer responsiveness to
a real report is untested.

### Requirement 1 — yes

`extends` accepts plain configuration objects. A preset is not a built
environment:

```ts
// packages/env/src/shared-preset.ts
export const sharedPreset = {
  id: "acme-shared",
  shared: {
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
  },
} as const;
```

```ts
// apps/web/env.config.ts
export default defineEnv({
  extends: [sharedPreset],
  clientPrefix: "NEXT_PUBLIC_",
  client: { NEXT_PUBLIC_API_URL: z.url() },
  server: { DATABASE_URL: z.url() },
  env: process.env,
});
```

Presets nest, and the docs state the merge rule plainly: "later entries override
earlier ones". The page also states the validation model: "extends merges
schemas so validation and types stay aligned across packages". Source:
[`apps/docs/content/docs/share-variables.mdx`](https://github.com/turbostarter/envin/blob/main/apps/docs/content/docs/share-variables.mdx).

One schema, validated once, from fragments owned by different packages. That is
requirement 1.

### Requirement 2 — yes

```ts
const values = options.envStrict ?? options.env ?? process.env;
```

Source: [`packages/core/src/index.ts:107`](https://github.com/turbostarter/envin/blob/main/packages/core/src/index.ts).

Same contract as `@t3-oss/env-core`, under the name `env` instead of
`runtimeEnv`.

### Requirement 3 — partial

The values improve. The type does not. The documentation says: "When skipping
validation, the default values are still used when possible. This is useful for
development environments where you want to use the default values but still have
the type safety." Source:
[`apps/docs/content/docs/customization.mdx`](https://github.com/turbostarter/envin/blob/main/apps/docs/content/docs/customization.mdx).

The implementation confirms defaults apply, and confirms the cast remains:

```ts
if (skip) {
  return {
    ...defaultValues,
    ...valuesWithDefaults,
    _schema: schema,
    // biome-ignore lint/suspicious/noExplicitAny: we set the type explicitly
  } as any;
}
```

Source: [`packages/core/src/index.ts:152-158`](https://github.com/turbostarter/envin/blob/main/packages/core/src/index.ts).

This fixes t3-env issue #266. It does not make the return type honest. A
required variable with no default and no value is still `undefined` behind a
`string` type.

The same docs page opens with a warning that skipping "will lead to your types
and runtime values being out of sync".

### Requirement 4 — no

ESM-only, the same as t3-env. The manifest sets `"type": "module"` and ships
only `.mjs`:

```json
".": { "types": "./dist/index.d.mts", "default": "./dist/index.mjs" }
```

Switching to `envin` keeps the `alwaysBundle` workaround in the Vite
configuration.

### Requirement 5 — no

`@envin/cli` registers exactly one command:

```ts
program
  .command("dev")
  .description("Starts the live preview of your environment variables")
```

Source: [`packages/cli/src/cli/index.ts`](https://github.com/turbostarter/envin/blob/main/packages/cli/src/cli/index.ts).

The live preview reads the schema and shows current values in a browser. It does
not write a template. The share-variables page even defers the problem to the
reader: "Document where developers copy `.env.example` from (often repo root or
per app)".

### Requirement 6 — yes

Three blocks instead of two. `shared` covers keys that both halves read,
`server` covers secrets, `client` covers prefixed keys. The docs state the
guarantee for `server`: "Never exposed to the client; accessing them in client
code is a type and runtime error." A `Proxy` and `onInvalidAccess` enforce it at
runtime, and `isServer` is configurable.

The `vite` preset ships in the box, alongside `vercel`, `fly`, `railway`,
`netlify`, `render`, `coolify`, and others.

### Requirement 7 — yes

Standard Schema throughout, with `isStandardSchema(finalSchema)` selecting
between the `~standard.validate` path and a dictionary path.

### Sharp edges

`envin` mutates the source object, and it does so unconditionally:

```ts
const values = options.envStrict ?? options.env ?? process.env;

for (const [key, value] of Object.entries(values)) {
  if (value === "") {
    delete values[key];
  }
}
```

Source: [`packages/core/src/index.ts:107-113`](https://github.com/turbostarter/envin/blob/main/packages/core/src/index.ts).

`@t3-oss/env-core` gates the same behaviour behind `emptyStringAsUndefined`, and
its maintainers have an open fix for it. In `envin` there is no flag to turn it
off. Pass `process.env` and the keys are gone.

The CLI is heavy. `@envin/cli@1.2.0` unpacks to 10,783,632 bytes with 23 runtime
dependencies, because it bundles a Next.js application to render the preview.
The core package stays at zero dependencies, so this cost only lands on the
developer machine that runs the preview.

## `znv`

**Version 0.5.0, published 2025-03-24.** MIT. Zero runtime dependencies. 113,812
bytes unpacked across 52 files.

Do not adopt this. The maintainer has stepped away and the package does not
support zod v4.

The npm peer dependency is `zod: ^3.24.2`. The repository's zod v4 catalog does
not satisfy it. Support for zod 4 exists on `master` — commit "feat: added
support for zod `4.x`, fixes #22", dated 2025-12-06 — and has never been
released. That commit is the only commit since the 0.5.0 tag, seventeen months
ago.

Issue [#24](https://github.com/lostfictions/znv/issues/24), "Release support for
zod v4", opened 2026-04-06 and is still open. The maintainer replied on
2026-04-28:

> Hey all, really sorry but I don't have the capacity to maintain this anymore.
> Would be happy to transfer ownership to a trusted contributor, or some kind of
> "zod userland" organization

A contributor offered to take over the next day. No transfer and no release has
happened since.

### Requirements

`znv` has the cleanest answer to requirement 2 of any candidate. The source is
the first positional argument, with no fallback at all:

```ts
export const { NICKNAME, LLAMA_COUNT, COLOR, SHINY } = parseEnv(process.env, {
  // ...
});
```

Source: [README](https://github.com/lostfictions/znv/blob/master/README.md).

Requirement 4 is met properly — the only candidate that ships a true dual build,
with `dist/` for ESM and `dist-cjs/` for CJS, and separate type entrypoints per
condition:

```json
".": {
  "import": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
  "require": { "types": "./dist-cjs/index.d.ts", "default": "./dist-cjs/index.js" }
}
```

Everything else fails. There is no composition primitive, no skip path, no
template generator, and no client/server concept. Requirement 7 fails as well:
`znv` is zod-only, and it re-exports `z` itself.

The design is worth borrowing even though the package is not. `parseEnv(source,
schemas)` is the shape `packages/env` already uses in `database.ts` and
`medusa.ts`.

## `varlock`

**Version 1.16.1, published 2026-08-08.** MIT. Zero npm dependencies, but
8,167,966 bytes unpacked across 212 files, because the package ships platform
binaries for local encryption.

This is the most active project of the six by a wide margin. Twelve releases
between 2026-06-19 and 2026-08-08, roughly weekly. Last push 2026-08-14. 4,166
stars and 53 open issues.

Varlock is the successor to `dmno`. The `dmno` README carries the notice:

> Maintenance mode: DMNO receives critical bug and security fixes only. For a
> suitable replacement, see Varlock.

Source: [dmno-dev/dmno](https://github.com/dmno-dev/dmno). The last `dmno`
release is 0.0.41 from 2025-12-01. The maintainers' recommendation is
unambiguous.

### The model

Varlock replaces TypeScript schemas with a committed `.env.schema` file. Rules
live in JSDoc-style decorator comments:

```bash
# @type=enum(development, staging, production)
APP_ENV=development #sets default value

# API key with validation, securely fetched from 1Password
# @required @sensitive @type=string(startsWith=sk-)
OPENAI_API_KEY=exec('op read "op://api-prod/openai/api-key"')
```

Source: [packages/varlock/README.md](https://github.com/dmno-dev/varlock/blob/main/packages/varlock/README.md).

This is the fork in the road. Adopting varlock means the environment contract
stops being zod and stops being TypeScript.

### Requirement 1 — yes

The monorepo guide is explicit: varlock "supports both per-package schemas and
shared root config, with `@import()` to compose them". The recommended layout is
"one `.env.schema` per project", each importing what it needs from the repo root
or a sibling package. Imports support `pick=[...]` and `omit=[...]` filters, and
the loader detects cycles and "fails with an explicit error naming the chain".

Source: [Monorepos](https://varlock.dev/guides/monorepos/).

### Requirement 2 — no

Varlock loads at import time on purpose. The `varlock/auto-load` entrypoint
"uses `execSync` to call out to the varlock CLI, sets resolved env vars into
`process.env`, and initializes varlock's runtime code". Application code then
reads a resolved object:

```js
import { ENV } from 'varlock/env';
const FROM_VARLOCK_ENV = ENV.MY_CONFIG_ITEM;
```

Source: [JavaScript integration](https://varlock.dev/integrations/javascript/).

There is no factory that accepts a source object. The alternative is process
injection — `varlock run -- node script.js` resolves and validates before the
target process starts.

For `apps/medusa` this is a real option, since Medusa's loader would receive an
already-validated `process.env`. It does not answer the requirement as written.

### Requirement 3 — partial

The documentation does not describe a skip-validation flag. The build-time
question changes shape: under `varlock run`, resolution and validation happen
outside the build process rather than inside it. The sources are silent on an
equivalent to `SKIP_ENV_VALIDATION`, so treat this as unanswered rather than
solved.

### Requirement 4 — different question

The main export is ESM. Two runtime entrypoints, `./init-server` and
`./init-edge`, ship `.cjs` builds. The `varlock run` model sidesteps the issue —
values arrive in `process.env` before the consumer loads, so the consumer's
module format does not matter. That covers `apps/medusa` and `drizzle.config.ts`
without a dual build.

### Requirement 5 — yes

Varlock is the only candidate that answers this. The schema itself is the
template. The docs recommend committing it: the schema-driven approach "is best
when shared with your team and committed to version control". `varlock init`
converts an existing `.env.example` into a schema, and `@example` decorators
carry sample values.

Source: [Schema guide](https://varlock.dev/guides/schema/).

Code generation goes further. `varlock codegen` "can turn that schema into
generated code: strongly-typed definitions for your language". The
`@generateTsTypes` decorator writes an `env.d.ts` that makes
`import { ENV } from 'varlock/env'` typed and augments `process.env` and
`import.meta.env`. Python, Rust, Go, PHP, Java, and C# have their own
decorators.

Source: [Code generation](https://varlock.dev/guides/code-generation/).

### Requirement 6 — yes, on different terms

Varlock separates secrecy from naming. Sensitivity is a decorator, not a prefix.
The Vite integration documents both modes: "All non-sensitive items are bundled
at build time via `ENV`, while `import.meta.env` replacements continue to only
include `VITE_`-prefixed items". A project that prefers the prefix convention
sets `@defaultSensitive=inferFromPrefix('VITE_')`.

Source: [Vite integration](https://varlock.dev/integrations/vite/).

TanStack Start has no separate package. The docs route it to the Vite
integration for Node, Vercel, Netlify, and self-hosted targets, and to the
Cloudflare integration for Workers. Public values inline at build time unless
marked `@dynamic`; server code reads `ENV.KEY` at runtime.

Source: [TanStack Start integration](https://varlock.dev/integrations/tanstack-start/).

The runtime adds log redaction and leak detection, which no other candidate
offers. `varlock scan` checks for secrets committed into source.

`@varlock/vite-integration@1.4.0`, published 2026-07-28, is MIT with zero
dependencies and 231,521 bytes unpacked. It peers on `varlock ^1.14.0` and
`vite >=5`.

### Requirement 7 — no

Varlock has its own type system in the `@env-spec` DSL. It does not implement
Standard Schema and does not consume zod schemas. Requirement 7 is not a feature
varlock is trying to offer.

### Cost

Adopting varlock costs the zod schema layer and requirement 7 outright, and puts
a CLI in front of every process entrypoint. The payoff is secret resolution from
1Password, AWS, and other backends, leak scanning, log redaction, and generated
types in six languages. Fifty-three open issues on a fast-moving project is a
normal ratio, not a warning, but it does mean pinning an exact version.

## `@julr/vite-plugin-validate-env`

**Version 2.2.2, published 2026-03-16.** MIT. 29,696 bytes unpacked across 6
files. Four runtime dependencies: `@poppinss/cliui`,
`@poppinss/validator-lite`, `@standard-schema/spec`, and `unconfig`.

Maintained but quiet. 232 stars, 2 open issues, last push 2026-03-16. Release
cadence is a few versions a year.

This is a Vite plugin, not a monorepo environment library. It covers one third
of one consumer.

### What it does

The plugin reads Vite's own environment loading and validates the result:

```ts
const { normalizePath, loadEnv } = await import('vite')
const env = loadEnv(config.mode, envDir, config.envPrefix)
const options = await loadOptions(rootDir, inlineOptions)
const variables = await validateAndLog(ui, env, options)
```

It then inlines validated values through Vite's `define`:

```ts
const define = Object.fromEntries(
  env.map(({ key, value }) => [`import.meta.env.${key}`, JSON.stringify(value)]),
)
```

Source: [`src/index.ts`](https://github.com/Julien-R44/vite-plugin-validate-env/blob/main/src/index.ts).

Requirement 7 is met. Set `validator: 'standard'` and zod, Valibot, or ArkType
schemas work in place of the built-in `Schema` helpers.

Type generation works through declaration merging. A `vite-env.d.ts` augments
`ImportMetaEnv` with `ImportMetaEnvAugmented<typeof import('../env').default>`.

### Where it fails

Requirement 2 fails. The source is whatever `loadEnv` returns for the resolved
mode and directory. There is no argument for supplying your own object. The
schema itself comes from an `env.ts` file discovered by `unconfig`, not from an
import.

Requirement 6 is partial. The plugin inherits Vite's `envPrefix` filter, so it
only ever sees prefixed keys. It does not guard server secrets — it never
receives them. Absence is not a guard.

Requirements 1, 3, 4, and 5 all fail. There is no composition, no skip path, no
CJS build, and no template generator.

The `loadAndValidateEnv()` export runs outside Vite and writes into
`process.env`. It is `async`, so it cannot run at module scope in a synchronous
loader. That rules out `apps/medusa` and `drizzle.config.ts`.

Keep this on the list as an optional Storefront-only addition later. It is not a
replacement for `packages/env`.

## Plain zod v4 with a helper

This is the baseline, and it wins on this repository's requirements.

Requirements 1, 2, 3, 4, and 7 are met by construction:

- **1** — `packages/env/src/schemas.ts` already does it. `databaseUrlSchema` is
  declared once and reused in `databaseEnvironmentSchema` and
  `medusaEnvironmentSchema`.
- **2** — `parse(source)` takes the source. No import-time read exists to
  remove.
- **3** — you own the return type, so you can make it honest. See below.
- **4** — zod ships dual entrypoints and the repository already consumes it from
  both formats. Removing `@t3-oss/env-core` removes the only ESM-only
  dependency, so `alwaysBundle` in `packages/env/vite.config.ts` goes away.
- **7** — zod implements Standard Schema. Any consumer that wants the interface
  can read `schema["~standard"]`.

### What you give up

Three things, all from requirement 6:

1. **The runtime access guard.** `@t3-oss/env-core` wraps the result in a
   `Proxy` that throws when client code touches a server key. Hand-rolled code
   returns a plain object.
2. **Type-level prefix enforcement.** The `ErrorMessage<...>` trick that fails
   compilation when a client key lacks its prefix is real work to reproduce.
3. **Deployment presets.** The `vercel`, `fly`, `railway`, `netlify`, and
   `vite` schema sets are free in both t3-env and envin. Writing the ones you
   need is cheap; the value is that somebody else keeps them current.

The Storefront has no browser-visible variables today, so none of these costs
anything now. They become real when the browser half arrives.

### What else you give up

Formatted validation errors. Both libraries print a grouped, readable failure
report and call `process.exit(1)`. Zod's raw `ZodError` is noisy. Budget a
small error formatter.

## What we build ourselves either way

Requirements 3 and 5 have no complete answer in any candidate. Plan to build
both.

### Requirement 3 — an honest build-time path

Today `packages/env/src/medusa.ts` casts:

```ts
if (source.SKIP_ENV_VALIDATION) {
  return source as z.infer<typeof medusaEnvironmentSchema>;
}
```

The type claims eight validated strings. The value is an arbitrary record. Every
library on this list makes the same claim — `@t3-oss/env-core` with
`return runtimeEnv as any`, `envin` with a documented `as any`.

Do not reproduce the lie. Two shapes fix it, and the second is better:

1. **Return a different type.** Have the skip path return a `Partial<Env>` and
   force call sites to handle absence. This is honest, and it pushes the cost
   onto every consumer.
2. **Do not skip. Narrow.** Derive a build-time schema from the same object
   schema, where the variables a build genuinely needs stay required and the
   rest become optional. `medusaEnvironmentSchema.partial({ ... })` produces it,
   and `z.infer` of the derived schema tells the truth with no cast.

Shape 2 keeps one code path, keeps validation on in every mode, and produces a
type that matches reality. It also removes the flag as a foot-gun — a build
cannot accidentally skip validation of something it needed.

This works only because the schema is composed from fragments. It is another
argument for keeping composition in zod rather than in a library's `extends`.

### Requirement 5 — a `.env` template generator

Only varlock covers this, and it does so by making the committed schema *be* the
template. The zod path has to write the generator.

zod v4 supplies the two pieces:

- `z.toJSONSchema(schema)` converts an object schema to JSON Schema, with
  `properties` and `required`. Source:
  [JSON Schema](https://zod.dev/json-schema).
- `.meta({ description, ... })` and `z.registry()` attach the comment text and
  example value that a template needs. `.describe("...")` is the shorthand for
  description alone. Source: [Metadata](https://zod.dev/metadata).

That is enough to emit a commented `.env.example` from
`medusaEnvironmentSchema` and friends. Put the command in `tooling/mze`
alongside the existing workflows, and add a CI check that fails when the
committed template drifts from the schema.

Two documented sharp edges to design around:

- `z.toJSONSchema()` throws on types it cannot represent unless you pass
  `unrepresentable: "any"`. Transforms and branded types will hit this.
- Metadata binds to a specific schema instance, and zod methods return new
  instances. Chaining after `.meta()` drops it. Attach metadata last, or use a
  registry keyed by field name instead.

## Decision

Remove `@t3-oss/env-core` from `packages/env`. Convert `src/server.ts` to the
`parse(source)` shape that `src/database.ts` and `src/medusa.ts` already use.
Replace the `SKIP_ENV_VALIDATION` cast in `src/medusa.ts` with a derived
build-time schema. Drop `alwaysBundle: "@t3-oss/env-core"` from
`packages/env/vite.config.ts` and keep the dual build for consumers 1 and 3.

Revisit when the Storefront gains browser-visible variables. At that point
compare a hand-written prefix guard against `envin`, and decide whether the
client/server machinery is worth an ESM-only dependency and a project with no
user issue history.

Reconsider `varlock` if the requirement changes from typed access to secret
management. It is the only candidate here under active weekly development, the
only one that solves the template requirement, and the only one that scans for
leaked secrets. It costs zod, requirement 7, and a CLI in front of every
process.
