# Varlock: the integration surface, re-checked

**Date checked:** 2026-08-15

**Scope:** the three objections that decided
[`varlock-evaluation.md`](./varlock-evaluation.md) against adoption. This
document does not repeat that document's feature survey, its twelve-decision
table, or its maturity section, except where a claim there is now wrong.

**Sources:** every page under `varlock.dev/integrations/` and
`varlock.dev/getting-started/`, the monorepo, telemetry, and CLI reference
pages, the docs source in the varlock repository
(`packages/varlock-website/src/content/docs/`, `main` at 2026-08-14), the
published `varlock@1.16.1` and `@varlock/vite-integration@1.4.0` packages, the
varlock CHANGELOG, the GitHub API, and the npm registry. Where a source says
nothing, this document says so.

## Result

**Two of the three objections were overstated. None of them falls completely.**

| Objection | Verdict |
| --------- | ------- |
| 1. No library API validates an explicit source object | **CONFIRMED** for the source object. **PARTLY OVERTURNED** for the failure report |
| 2. Fourteen permanent wrappers, and unwrapped processes fail silently | **PARTLY OVERTURNED** — the honest count is ten committed sites, and the silent failure is Medusa-specific and removable |
| 3. The sources are silent on this stack | **PARTLY OVERTURNED** — TanStack Start, Docker, and mise each have a full page. `vite-plus`, bun workspaces, and drizzle-kit stay silent |

The recommendation in `varlock-evaluation.md` still stands, and it now stands on
one leg instead of three. Decisions 2 and 10 remain true conflicts. Decision 12
is a smaller conflict than recorded. The wrapper cost is real but lands
differently, and the mise page argues against the shape the user hoped for
rather than supporting it.

---

## Objection 1 — the programmatic API

> "There is no library API that validates an explicit source object. Every entry
> point is a process boundary."

**Verdict: CONFIRMED on the source object. PARTLY OVERTURNED on the failure
report.**

### What `integrations/javascript/` documents

The page documents five things, not the three the prior research listed.

1. **`varlock/auto-load`.** The page's own words: it "uses `execSync` to call out
   to the varlock CLI (or reuses env injected by a parent `varlock run`), sets
   resolved env vars into `process.env`, and initializes varlock's runtime code,
   including: varlock's `ENV` object, log redaction (if enabled), leak detection
   (if enabled)".
2. **`varlock/env`.** One import, one object:

   ```js
   import 'varlock/auto-load';
   import { ENV } from 'varlock/env';

   const FROM_VARLOCK_ENV = ENV.MY_CONFIG_ITEM; // recommended
   const FROM_PROCESS_ENV = process.env.MY_CONFIG_ITEM; // still works
   ```

3. **`varlock run -- <your-command>`.** The page states the trade plainly: "This
   will not inject any runtime code, and varlock's `ENV` object will not be
   available."
4. **A load-failure hook.** `globalThis._varlockOnLoadError(err, env)`, called
   with the error and a map of the values that did resolve. The prior research
   missed this.
5. **Injected-blob reuse.** Since 1.16.0, auto-load reuses a parent
   `varlock run`'s `__VARLOCK_ENV` blob instead of calling the CLI again.

Source: [JavaScript integration](https://varlock.dev/integrations/javascript/).

### Is there an exported function that takes a source object?

**No.** Checked against the published `varlock@1.16.1` manifest, which declares
fourteen export paths: `.`, `./env`, `./auto-load`, `./patch-console`,
`./patch-response`, `./patch-server-response`, `./init-server`, `./init-edge`,
`./encrypt-env`, `./exec-sync-varlock`, `./config`, `./config.js`,
`./plugin-lib`, `./test-helpers`.

The root export is unchanged from the prior pass. `load()` still takes no
options and still returns nothing:

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

The root export also carries `getBuildTimeReplacements()`, which reads the
`__VARLOCK_ENV` blob and returns `ENV.KEY` to value replacements for a bundler.
It reads a blob that a process boundary already produced.

`internal.loadEnvGraph` accepts `overrideValues` and `processEnvOverride`, both
typed `Record<string, string | undefined>`. Neither is the source. Both are
override layers applied on top of a graph whose schema comes from
`basePath` or `entryFilePaths` — filesystem paths in every branch of the
function.

Source:
[`packages/varlock/src/env-graph/lib/loader.ts`](https://github.com/dmno-dev/varlock/blob/main/packages/varlock/src/env-graph/lib/loader.ts).

**One new fact, which does not change the verdict.** The schema itself can come
from memory. `FileBasedDataSource` takes an `overrideContents` string, and
`EnvGraph.setVirtualImports(basePath, files)` substitutes a
`Record<string, string>` for the filesystem when resolving `@import()`. So an
in-process caller can supply schema *text* without touching disk. It still
cannot supply the *values* as an object and get typed output back. The gap
decisions 2 and 10 describe is the values gap, and it is intact.

### What `varlock/auto-load` does at import time

Read from
[`packages/varlock/src/auto-load.ts`](https://github.com/dmno-dev/varlock/blob/main/packages/varlock/src/auto-load.ts):

1. Evaluates whether a parent `varlock run` blob can be reused.
2. If not, calls `execSyncVarlock('load --format json-full --compact')`. It
   passes `callerDir` set to the varlock package's own directory, so binary
   resolution in a monorepo starts inside `apps/web/node_modules/varlock`
   instead of at `process.cwd()`. This closes issue
   [#546](https://github.com/dmno-dev/varlock/issues/546), a monorepo
   `playwright.config.ts` failure.
3. Writes the blob into `process.env.__VARLOCK_ENV`, encrypting it when
   `@encryptInjectedEnv` is on.
4. On failure: writes the CLI's stderr, then runs the hook or exits.
5. Calls `initVarlockEnv()`, then patches the global console, `ServerResponse`,
   and `Response`.

**Can it work when a foreign loader started the process?** The module is a
side-effect ESM import with no top-level await. Any loader that can execute an
ESM import can run it. The blocker recorded in
[ADR-0012](../adr/0012-the-medusa-backend-is-a-tsc-island.md) — ts-node 10.9.2
refusing ESM inside Medusa's synchronous `require()` — is unchanged, and the
docs are silent on it. The documented answer for that case is `varlock run`,
where the config file imports nothing.

The blob-reuse rules matter for a monorepo and the docs state them exactly:
reuse happens only when "the blob was resolved in the same directory the app
would resolve in (a root-level `varlock run` in a monorepo does not stop
per-package resolution)", it resolved without errors, and no recorded override
changed. `_VARLOCK_USE_INJECTED_ENV=1` forces trust and skips the directory
check.

### Is there a documented in-process resolve?

**No.** The docs never mention `load()`, `internal`, or `loadEnvGraph`. Every
documented path either spawns the CLI or is spawned by it. The one reference to
"programmatically" in the whole docs tree describes framework integrations
consuming `varlock load --format json-full` from a subprocess.

### Can a custom failure report be built?

**Yes, and this is where the prior conclusion is wrong.** The evaluation said
"there is no documented hook to replace or extend it". There is a documented
hook.

```js
import * as Sentry from '@sentry/node';

globalThis._varlockOnLoadError = (err, env) => {
  Sentry.init({ dsn: env.SENTRY_DSN });
  Sentry.captureException(err);
  return Sentry.close(2000); // return the promise; auto-load exits once it settles
};
```

The hook must be registered before `varlock/auto-load` is imported, through its
own side-effect import. `_VARLOCK_THROW_ON_LOAD_ERROR=1` gives the same throw
behaviour with no hook.

Two limits, both documented. Reporting is best-effort — auto-load does not await
the hook, it gives async work a bounded window and then forces the exit. And
"only resolved values are available to the hook, so this does not help with
`.env` parse or schema errors, where resolution is skipped entirely".

A third limit is not documented, and comes from the source: auto-load writes the
CLI's stderr **before** it calls the hook. A custom report is therefore additive.
Varlock's own report always prints first.

Beyond the hook, more surface exists than the prior pass found:

- `varlock load --format json-full` returns "the full serialized graph:
  top-level `basePath`, `sources`, `config` (per-item metadata including resolved
  value, validation state, and sensitivity), `settings`". Per-item errors, not
  just values.
- `varlock/env` exports `redactSensitiveConfig`, `revealSensitiveConfig`,
  `scanForLeaks`, and `getRedactionMapInfo`. None appear in the docs.
- `internal` exports `EnvGraph`, `loadEnvGraph`, `checkForConfigErrors`, and the
  five error classes. `checkForSchemaErrors` already groups its output per data
  source, which is per file — close to what decision 12 asks for.

### Objection 1, settled

Decision 2 (factories taking an explicit source object) and decision 10
(`loadSource({ cwd })` returning a plain object) are **still true conflicts**.
Nothing in the pages the user named changes them.

Decision 12 (a custom failure report) is **a smaller conflict than recorded**.
You can add a report on top of varlock's; you cannot suppress varlock's.

---

## Objection 2 — how many wrappers are really needed

> "14 entry points need permanent `varlock run` wrappers, and a process started
> without the wrapper fails SILENTLY."

**Verdict: PARTLY OVERTURNED.**

### mise does not remove per-command wrappers

The mise page opens by arguing against the exact idea. Its first block is titled
"Inject into commands, not your shell":

> mise can load environment variables into your shell session (via `[env]`), but
> we **don't recommend** loading your varlock-managed env (especially secrets)
> that way. Once values live in your shell, every process inherits them, they
> show up in `env`, and varlock's log redaction is bypassed.

Shell injection is documented, in a section labelled advanced, using mise's
`env._.source`:

```bash title=".mise/load-env.sh"
varlock load --format shell --compact
```

```toml title="mise.toml"
[env]
_.source = "./.mise/load-env.sh"
```

**Mechanism:** mise runs the script and captures exported variables into the
shell session. **Subprocesses:** covered, and that is the stated problem —
"anything loaded this way lives in your shell session and is inherited by every
process you launch, and varlock's log redaction does not apply". **CI:** not
covered. The mise page has no CI section; the docs route CI to the
[GitHub Action](https://varlock.dev/integrations/github-action/) or to
`varlock run`.

The page also rejects mise's own redaction as a substitute, quoting mise's docs:
redaction "does not prevent the values from being exported to child processes".

What mise does contribute is real, and the prior research missed it:

```toml title="mise.toml"
[hooks]
enter = "varlock load > /dev/null"
```

`varlock load` exits non-zero on a validation error, so a broken environment
announces itself when you `cd` into the directory. mise can also install the
CLI as a versioned tool through the `github:dmno-dev/varlock` backend, which
needs no Node or Bun runtime and verifies checksums and build attestations.

Source: [mise integration](https://varlock.dev/integrations/mise/).

### The wrapper remover this repository nearly has

The bun page documents a preload that does remove wrappers:

```toml title="bunfig.toml"
preload = ["varlock/auto-load"]
```

> If you do this, you will no longer have to use `bun run varlock run --
> yourscript` or use `import 'varlock/auto-load'` in your code!

It comes with a documented caution: do not use preload with a framework
integration, because those integrations watch `.env` files for live reload.

**It buys this repository almost nothing.** `bunfig.toml preload` applies to the
bun *runtime*. This repository pins bun as the package manager and runs node as
the runtime — `mise.toml` pins `node = "24.18.1"`, the root scripts call
`node tooling/mze/main.ts`, and `medusa`, `drizzle-kit`, and `jest` are all node
processes. Node's equivalent (`NODE_OPTIONS="--import varlock/auto-load"`) is
**not documented anywhere in the varlock docs**.

Source: [Bun integration](https://varlock.dev/integrations/bun/).

### Docker: build time against run time

The Docker page is the most complete of the pages named, and it leads with a
decision table rather than a recipe.

| Approach | When | Varlock in the production image? |
| -------- | ---- | -------------------------------- |
| CI-only validation | Runtime env comes from the platform | No. Run `varlock load` in CI only |
| Runtime injection | Containers that resolve secrets at boot through plugins | Yes. `varlock run` as the entrypoint |
| Build-time | SSR apps where a framework integration injects into build output | Only in a builder stage, never the final image |

**Secrets in a multi-stage build.** The page names the anti-pattern directly:
anything written during `RUN` persists in image history, so
`RUN varlock load > /app/.env.production` and `ARG OP_SERVICE_ACCOUNT_TOKEN` are
both wrong. The documented answers are secret-zero credentials passed at
runtime, multi-stage builds that discard builder artifacts, and
`@encryptInjectedEnv` for SSR output.

**Does the image entrypoint need a wrapper?** Only for the runtime-injection
role:

```dockerfile
ENTRYPOINT ["varlock", "run", "--"]
CMD ["node", "dist/server.js"]
```

The page documents a single-process alternative for tight memory limits:
`eval "$(varlock load --format shell --compact)" && exec node dist/server.js`.
It also states that `varlock run` forwards `SIGTERM`, `SIGINT`, `SIGHUP`, and
`SIGQUIT` to the child, propagates the child's exit status (`128+N` on a
signal), and is safe as PID 1.

**Monorepo build context.** `varlock flatten` collapses the `@import` graph into
a self-contained directory and rewrites the paths. It skips `.env.local` files
by default so machine-local secrets stay out of layers, and
`flatten --vendor-plugins` copies plugin packages in for offline or shell-less
images.

Sources: [Docker integration](https://varlock.dev/integrations/docker/),
[`varlock run` reference](https://varlock.dev/reference/cli/load-and-run/#run).

### The recount

The prior figure of fourteen counted every command that reads a validated value.
It did not account for the fact that most of them already run under one process
this repository controls.

`bun run dev`, `bun run build`, `bun run test`, `bun run test:e2e`, and
`bun run check` all go through `node tooling/mze/main.ts`.
[`tooling/mze/services.ts`](../../tooling/mze/services.ts) already builds an
`Environment` record and injects it into the children it spawns. One `varlock
run` around the `mze` process, or one `varlock load --format json` call inside
it, covers everything it spawns.

| Entry point | Prior verdict | Now | Reasoning |
| ----------- | ------------- | --- | --------- |
| `medusa build` (build, check-types) | Wrapper | Covered by `mze build`; explicit in the Dockerfile builder | `vp run -t medusa#build` is spawned by the mze CLI locally and by `RUN` in the image |
| `medusa develop` (dev:raw) | Wrapper | Covered by `mze dev` | Already spawned by the mze CLI under Portless |
| `medusa start` | Wrapper or ENTRYPOINT | Docker `ENTRYPOINT`, or platform-injected env | The Docker page's CI-only role removes the CLI from the image entirely |
| `medusa db:migrate`, `db:rollback` | Wrapper ×2 | **Wrapper ×2** | Run directly by developers and by operators |
| `medusa exec` seed, seed:probe | Wrapper ×2 | **Wrapper ×2** | Run directly |
| `medusa user` (operator:create) | Wrapper | **Wrapper ×1** | Run directly |
| `jest` integration tests | Wrapper | Covered by `mze test` | Spawned by the mze CLI |
| `drizzle-kit` push, generate, studio, migrate | Wrapper ×4 | **Wrapper ×4** | Run directly, and drizzle-kit loads its own dotenv today |
| `playwright` | Wrapper | Covered by `mze test e2e` | Spawned by the mze CLI |
| `mze` CLI | Wrapper | **One site** — a root script prefix or one call inside the CLI | The single lever this repository has |
| storefront `vp dev`, `vp build`, `vp preview` | Free | Free | Vite plugin, unchanged |

**Honest count: ten committed wrapper sites.** Nine package scripts
(`apps/medusa` ×5, `packages/db` ×4) plus one site for the `mze` CLI. Add one
Dockerfile `ENTRYPOINT` change and one Dockerfile builder step, both of which
are configuration rather than a wrapper in a script. The storefront's three stay
free.

Two caveats on the mze lever. A root-level `varlock run` in a monorepo "does not
stop per-package resolution", so a package that imports `varlock/auto-load`
would still resolve for itself — this repository's packages read `process.env`,
so they are covered. And a single root resolution needs a schema at the root
that carries every key, which is the central-fragment layout the
[Monorepos guide](https://varlock.dev/guides/monorepos/) advises against. That
tension is already recorded in `varlock-evaluation.md` under decision 8.

### Is "silent failure when unwrapped" still true?

**For Medusa, yes. Everywhere else, no.**

`apps/medusa/medusa-config.ts` calls
`loadEnv(process.env.NODE_ENV || "development", process.cwd())` from
`@medusajs/framework/utils`. Medusa loads `.env` itself. An unwrapped Medusa
process therefore reads whatever is on disk and validates none of it. That is a
genuine silent failure, and it disappears the moment that `loadEnv()` call is
removed.

For every other command the failure is loud. Node does not auto-load `.env`, and
the bun page tells you to set `env = false` in `bunfig.toml` to stop bun doing
it. An unwrapped `drizzle-kit` or `jest` gets nothing and crashes on the first
missing value, with the tool's own error rather than varlock's.

The mise `[hooks] enter` recipe makes the local case loud regardless: the
environment is validated on `cd`, before any command runs.

---

## Objection 3 — the specific stack

> "The sources are silent on vite-plus, bun workspaces, TanStack Start,
> drizzle-kit, Docker and mise."

**Verdict: PARTLY OVERTURNED.** Three of the six have dedicated pages. Three
remain silent.

### TanStack Start — a full page

[TanStack Start integration](https://varlock.dev/integrations/tanstack-start/).

**What it gives.** A routing decision and a one-line plugin change. TanStack
Start "is a full-stack React framework built on Vite, so there's no dedicated
TanStack Start package". Node, Vercel, Netlify, and self-hosted go to the Vite
plugin. Cloudflare Workers go to `@varlock/cloudflare-integration` and
`varlock-wrangler`. A working reference project exists at
`dmno-dev/varlock-examples`.

**What it requires.** `@varlock/vite-integration` and `varlock`, `varlock init`,
and `varlockVitePlugin()` added before `tanstackStart()` in the plugin array.

**Server/client split and `import.meta.env`.** Both are handled, and the page is
explicit about the difference from stock behaviour. TanStack Start inherits
Vite's approach — `process.env` on the server, `import.meta.env` on the client,
`VITE_` prefix for exposure — and their docs "recommend maintaining a manual
`src/env.d.ts` for TypeScript support and separate Zod schemas for runtime
validation". Under varlock the `.env.schema` replaces the type declarations, the
zod schemas, and the prefix convention. Public values inline at build time
unless marked `@dynamic`; server code reads `ENV.KEY` at runtime; browser access
to a public dynamic value needs a server route returning `getPublicDynamicEnv()`
with `loadPublicDynamicEnv()` on the client.

One SSR caveat the page states: varlock injects the resolved env into
server-side build output as plaintext JSON, and `@encryptInjectedEnv` exists to
harden it against sourcemap leaks.

This repository's storefront uses `nitro/vite`. Varlock 1.16.1 shipped a fix
for exactly that combination: PR
[#984](https://github.com/dmno-dev/varlock/pull/984), "fix `@preventLeak`
breaking srvx-based servers (TanStack Start, Nitro) by patching the global
Response with a proxy instead of a subclass". The pairing is exercised, not
theoretical.

### Vite — what the plugin does

[Vite integration](https://varlock.dev/integrations/vite/).

Four documented jobs: load and validate through varlock and inject into
`process.env` at build and dev time; make env vars usable inside `vite.config.*`
through `import { ENV } from 'varlock/env'`; replace `ENV.xxx` at build time for
non-sensitive items with no prefix required; and inject initialization code plus
security features into SSR entry points.

**Config options.** `ssrInjectMode` takes three values:

- `init-only` — injects initialization code but does not load env. You still
  boot through `varlock run`.
- `auto-load` — injects `import 'varlock/auto-load';`.
- `resolved-env` — bakes the fully resolved env into the built code, for
  platforms with no control over the build command.

When unset, the plugin infers the mode from other plugins and environment
variables, and defaults to `init-only`.

**Prefix handling.** Sensitivity is decoupled from naming through
`@defaultSensitive` and `@sensitive`. `@defaultSensitive=inferFromPrefix('VITE_')`
keeps the prefix convention. The bundling rule is stated as a caution: "All
non-sensitive items are bundled at build time via `ENV`, while `import.meta.env`
replacements continue to only include `VITE_`-prefixed items."

**Keeping server values out of the client bundle.** Marking an item `@sensitive`
excludes it from build-time replacement. `@dynamic` keeps a public value out of
the client bundle and resolves it at runtime.

**Custom file location.** `varlock.loadPath` in `package.json`, a string or an
array of paths where later entries win. Vite's own `envDir` is explicitly
ignored, with a warning.

### `vite-plus` and Vite 8 — silent, and less risky than it looked

**The docs say nothing.** Zero matches for `vite-plus`, `vp`, `voidzero`,
`rolldown`, or "Vite 8" across the whole docs tree. The varlock issue tracker
has zero matches for `vite-plus`, `voidzero`, or `rolldown` in any title.

**New evidence changes the assessment.** The published
`@varlock/vite-integration@1.4.0` bundle (5 files, 231,521 bytes, zero runtime
dependencies) **imports nothing from `vite`**. Its only imports are `fs`,
`path`, and six `varlock/*` entry points. It is a plain plugin object using
standard hooks: `config`, `configResolved`, `configureServer`, `resolveId`,
`load`, `transform`, `transformIndexHtml`, and `renderChunk`.

A plugin that never touches Vite's own API is as portable as the plugin
container it runs in. This repository already aliases `vite` to
`@voidzero-dev/vite-plus-core@0.2.6` through a root `overrides` entry, and
`apps/storefront/vite.config.ts` imports `defineConfig` from `vite-plus` while
running `tanstackStart()`, `nitro()`, `viteReact()`, and `tailwindcss()` — all
plugins written against the same contract.

One concrete friction remains. The package declares
`peerDependencies: { "varlock": "^1.14.0", "vite": ">=5" }`. Against a resolved
`vite` of version `0.2.6`, that range does not match, so bun reports a peer
mismatch. The plugin is untested under `vite-plus` and the risk is a warning and
a possible hook-signature drift, not a missing API.

### bun and bun workspaces

[Bun integration](https://varlock.dev/integrations/bun/) covers the bun
**runtime** only. Two items: disable bun's automatic `.env` loading with
`env = false` in `bunfig.toml` (or `--no-env-file`, or
`--no-compile-autoload-dotenv` for a compiled binary), and the optional
`preload` recipe.

**Bun workspaces: silent.** The word does not appear. The
[Monorepos guide](https://varlock.dev/guides/monorepos/) mentions "root-level
dependency overrides" and links to the Next.js page for them, but the override
recipe itself carries tabs for npm, yarn, and pnpm only.

**What is missing for bun.** The dotenv-override recipe in
[Migrate from dotenv](https://varlock.dev/guides/migrate-from-dotenv/) shows
npm `overrides`, yarn `resolutions`, and pnpm `overrides` in
`pnpm-workspace.yaml`. There is no bun tab. The pnpm and yarn tabs both carry a
bolded note that the override must live in the repository root. This repository
already uses a root `overrides` block for `vite`, so the field and its placement
are known to work here — but nothing in the varlock docs states that bun honours
a `npm:varlock` alias for a transitive `dotenv`, and nothing states how a bun
workspace catalog interacts with it.

### Monorepos

[Monorepos guide](https://varlock.dev/guides/monorepos/).

**Recommended layout:** one `.env.schema` per project, next to the code, with
shared keys imported from the repository root or a sibling. The guide says
directly: "Avoid funneling every variable into a single central env directory."
Decision 8 in `varlock-evaluation.md` asks for the opposite; that conflict is
unchanged.

**Composition:** `@import()` with `pick=[...]` and `omit=[...]`. Importing a
directory (`../../`) pulls `.env.local` and environment files too; importing a
file pulls only that file and its own imports. Imported definitions merge and
the importing file wins. Circular imports fail with an error naming the chain.

**Types across packages:** one `varlock/env` module exists per TypeScript
program, so several schemas augment it together and a package can see keys it
never declared. `@generateTsTypes(path=./env.ts, exposeEnv=local)` scopes it,
and turns the `process.env` and `import.meta.env` augmentations off. The output
path must be `.ts`, not `.d.ts`.

**Task runners:** the guide has a Turborepo section covering strict environment
mode. It is **silent on `vite-plus` as a task runner**, which is what this
repository uses (`vp run -t medusa#build`). The Turborepo warning generalises —
any task runner that filters the ambient environment must pass through the
environment flag and the CI-detection variables.

### drizzle-kit, jest, playwright, generic Node CLIs

- **drizzle-kit: silent.** No page, no mention. The generic answer is
  `varlock run -- drizzle-kit ...`, and the JavaScript page states it: "Even
  when using a deeper integration for your code, you may still need to use
  `varlock run` when calling external scripts/tools, like database migrations."
- **jest: mentioned, not covered.** It appears twice, both as
  `"test": "APP_ENV=test jest"` in a scripts block. The
  [builtin variables reference](https://varlock.dev/reference/builtin-variables/)
  notes that test runners set `NODE_ENV=test` after the process starts, often
  after varlock has resolved, so `VARLOCK_ENV` may not detect `test`. The
  documented fix is an explicit `VARLOCK_ENV=test varlock run -- vitest`.
- **playwright: no docs.** One closed issue,
  [#546](https://github.com/dmno-dev/varlock/issues/546), reported that
  `varlock/auto-load` inside a monorepo `playwright.config.ts` could not resolve
  the CLI binary because resolution started at `process.cwd()`. Fixed, and the
  `callerDir` argument in the current auto-load source is the fix.
- **Generic Node CLIs: covered.** `varlock run -- <command>` is the documented
  answer, with `varlock printenv <KEY>` for embedding one value in a larger
  shell command.

---

## Every integration page

| Page | Covers | Applies here? |
| ---- | ------ | ------------- |
| [overview](https://varlock.dev/integrations/overview/) | Index; points monorepos at the Monorepos guide first | Yes, as a map |
| [javascript](https://varlock.dev/integrations/javascript/) | `auto-load`, `ENV`, `varlock run`, load-error hook, blob reuse | Yes — the core page for `mze`, drizzle-kit, jest |
| [bun](https://varlock.dev/integrations/bun/) | `env = false`, optional `preload` | Partly — package manager only, runtime is node |
| [vite](https://varlock.dev/integrations/vite/) | Plugin, `ssrInjectMode`, `loadPath`, prefixes, sensitivity | Yes — storefront |
| [tanstack-start](https://varlock.dev/integrations/tanstack-start/) | Routes to the Vite plugin; dynamic+public recipe | Yes — storefront |
| [docker](https://varlock.dev/integrations/docker/) | Three roles, GHCR image, multi-stage, `flatten`, entrypoint | Yes — both Dockerfiles |
| [mise](https://varlock.dev/integrations/mise/) | Install the CLI, tasks, `enter` hook; argues against shell injection | Yes — root `mise.toml` |
| [direnv](https://varlock.dev/integrations/direnv/) | `eval "$(varlock load --format shell)"` in `.envrc`, `watch_file` | Alternative to mise shell injection; same objections |
| [github-action](https://varlock.dev/integrations/github-action/) | Validate `.env.schema` in workflows, export as env or JSON | Yes — `release.yml` |
| [cloudflare](https://varlock.dev/integrations/cloudflare/) | Workers plugin, `varlock-wrangler` | No — self-hosted containers |
| [nextjs](https://varlock.dev/integrations/nextjs/) | `@next/env` replacement, monorepo overrides | No |
| [astro](https://varlock.dev/integrations/astro/) | Astro integration on the Vite plugin | No |
| [sveltekit](https://varlock.dev/integrations/sveltekit/) | Vite plugin, or Cloudflare adapter | No |
| [expo](https://varlock.dev/integrations/expo/) | Babel plugin, Metro config wrapper | No |
| [python](https://varlock.dev/integrations/python/) | `varlock run` plus a generated typed module | No |
| [rust](https://varlock.dev/integrations/rust/) | Generated serde module | No |
| [go](https://varlock.dev/integrations/go/) | Generated package | No |
| [java](https://varlock.dev/integrations/java/) | Generated typed class | No |
| [php](https://varlock.dev/integrations/php/) | Generated typed class | No |
| [csharp](https://varlock.dev/integrations/csharp/) | Generated typed class | No |
| [other-languages](https://varlock.dev/integrations/other-languages/) | Generated-module overview for any runtime | No |

Twenty-one pages. Seven apply to this repository.

---

## Also settled

**Telemetry is still on by default.** Four opt-outs, one more than the prior
research listed:

1. `varlock telemetry disable`, written to `~/.config/varlock/config.json`.
2. `VARLOCK_TELEMETRY_DISABLED=true`.
3. `DO_NOT_TRACK=1`, honoured since 1.16.1 (PR
   [#986](https://github.com/dmno-dev/varlock/pull/986)).
4. **A project-level file**, `.varlock/config.json` with
   `{ "telemetryDisabled": true }`. This one is committable, so the decision
   travels with the repository instead of living on each machine.

The collected set now includes a coarse `error_code` category (`parse_error`,
`schema_error`, `validation_error`, and others), schema feature signals, and the
detected package manager. The page states values and config files are never
collected. Source:
[Telemetry guide](https://varlock.dev/guides/telemetry/).

**Stability policy: still silent.** No SemVer statement, no support window, no
deprecation policy in the docs, `README.md`, or `CONTRIBUTING.md`. The one
exception is the credential proxy, which carries an explicit warning that its
"flags, decorators, and behavior may change (including breaking changes) in
minor releases before it's finalized in a future major".

**Version: no drift.** `varlock@1.16.1`, published 2026-08-08, is still the
`latest` dist-tag. `@varlock/vite-integration@1.4.0`, published 2026-07-28. The
repository was pushed 2026-08-14, with 4,167 stars, 31 open issues, and 22 open
pull requests. Every figure in `varlock-evaluation.md` holds.

---

## What the prior research got wrong

Named claims from [`varlock-evaluation.md`](./varlock-evaluation.md) that this
pass contradicts:

1. **"The documented paths are three."** Five. The page also documents the
   `globalThis._varlockOnLoadError` hook with `_VARLOCK_THROW_ON_LOAD_ERROR`,
   and injected-blob reuse.
2. **"There is no documented hook to replace or extend it."** Wrong. The hook is
   documented, and it receives the error plus the values that did resolve.
   The correct statement is narrower: the hook extends the report and cannot
   replace it, because auto-load writes varlock's stderr first.
3. **"What you can build is a wrapper that parses `varlock load --format
   json-full` and reprints it — which means running resolution twice, or
   wrapping the wrapper."** Wrong since 1.16.0. Blob reuse skips the second
   resolution when the directory matches, and the hook path costs no second
   resolution at all.
4. **"That is roughly fourteen entry points."** Over-counted. Medusa build,
   Medusa develop, jest, and playwright are already spawned by the `mze` CLI,
   which is a single injection point this repository owns. The honest figure is
   ten committed sites plus two Dockerfile changes.
5. **"A process that skips the wrapper fails silently rather than loudly."**
   True only for Medusa, and only because `medusa-config.ts` calls Medusa's own
   `loadEnv()`. Everywhere else the failure is loud. mise's `[hooks] enter`
   makes the local case loud in all cases.
6. **The wrapper analysis never mentioned mise or bun preload.** Both are
   documented, and both change the picture — mise by arguing against shell
   injection and offering an entry-time validation hook instead, bun preload by
   removing wrappers for bun-runtime processes only.
7. **The telemetry opt-out list omitted the project-level file.**
   `.varlock/config.json` can be committed.
8. **"whether a plugin peered on `vite >=5` behaves identically there is
   untested and undocumented."** Still undocumented, still untested, but the
   published bundle imports nothing from `vite`, which makes portability much
   more likely than that sentence implies.

Claims this pass **upholds**:

- **"Varlock has no library API that validates an explicit source object."**
  Correct. Verified against all fourteen export paths in `varlock@1.16.1`.
- **Decision 2 and decision 10 conflict outright.** Unchanged.
- **"The sources are silent on Vite+ / `vite-plus`."** Correct. Zero matches in
  the docs and zero in the issue tracker.
- **"The docs are silent on bun workspaces specifically."** Correct. The
  dotenv-override recipe still lists npm, yarn, and pnpm only.
- **"The Docker guide is unusually direct about not shipping the CLI."**
  Correct, and the guide is more complete than that summary conveys.
- **"The Monorepos guide recommends the opposite layout" to decision 8.**
  Correct, verbatim.
- **The maturity picture, the version, and the telemetry default.** Unchanged.
- **The ADR-0012 ts-node problem.** Unchanged, and the docs remain silent on it.

---

## What adoption looks like for this repository

A sketch for judging size. Not a plan.

### `mise.toml`

Add the CLI as a tool and a validation hook. Do not add `[env]`.

```toml
[tools]
node = "24.18.1"
bun = "1.3.14"
"github:dmno-dev/varlock" = "1.16.1"

[hooks]
enter = "varlock load > /dev/null"
```

The `github` backend needs no runtime and mise verifies checksums and
attestations. Pin the exact version — the docs warn that `latest` lags a fresh
release by about 24 hours because of mise's `minimum_release_age` default.

Shell injection through `env._.source` stays out. The varlock docs argue against
it, and this repository's `tooling/mze` already owns environment composition.

### `apps/medusa/Dockerfile`

Three changes.

1. Builder stage — copy the binary and validate before the build:

   ```dockerfile
   COPY --from=ghcr.io/dmno-dev/varlock:1.16.1 /usr/local/bin/varlock /usr/local/bin/varlock
   RUN apk add --no-cache ca-certificates libstdc++   # only on Alpine bases
   ```

   The runtime base here is `node:24-bookworm-slim`, so the Alpine note does not
   apply; the binary is Bun-compiled and needs `libstdc++` and `ca-certificates`
   on musl bases only.

2. Builder stage — `varlock flatten` before `vp run -t medusa#build`, because
   `@import()` across `packages/env` reaches outside the app directory. The
   build context here is the repository root, so `flatten` is optional; keep it
   if the context ever narrows.

3. Runtime stage — pick one role. If the platform injects environment variables,
   the CLI stays out of the image and CI runs `varlock load`. If secrets resolve
   at boot, replace the `CMD` with:

   ```dockerfile
   ENTRYPOINT ["varlock", "run", "--"]
   CMD ["/app/node_modules/.bin/medusa", "start"]
   ```

   `varlock run` forwards signals and propagates exit codes, so `docker stop`
   still reaches Medusa.

### `apps/storefront/Dockerfile`

Delete `ENV SKIP_ENV_VALIDATION=1`. The Vite plugin resolves and validates during
`vp run -t storefront#build`, and `@required=forEnv(production)` expresses what
the flag was faking. The runtime stage stays as it is — the storefront runs
`node .output/server/index.mjs` with values already inlined or injected by the
platform, so no CLI belongs in that image.

Both images also need `VARLOCK_TELEMETRY_DISABLED=true` or `DO_NOT_TRACK=1` if
the telemetry decision goes that way, or the committed `.varlock/config.json`
covers it once for every context.

### The Vite and TanStack Start plugin

```ts title="apps/storefront/vite.config.ts"
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { varlockVitePlugin } from "@varlock/vite-integration";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite-plus";

export default defineConfig({
  server: { port: 3001 },
  resolve: { tsconfigPaths: true },
  plugins: [varlockVitePlugin(), tailwindcss(), tanstackStart(), nitro(), viteReact()],
});
```

The docs place `varlockVitePlugin()` before `tanstackStart()`. Set
`ssrInjectMode` explicitly rather than relying on inference, since the inference
reads the plugin list and has never seen this one. `init-only` matches a
self-hosted container where the entrypoint provides the environment;
`auto-load` matches a container that resolves at boot.

The peer range `vite >=5` will not match `@voidzero-dev/vite-plus-core@0.2.6`.
Expect a peer warning from `bun install` and decide whether to silence it.

### `apps/medusa/medusa-config.ts`

```ts
import { defineConfig } from "@medusajs/framework/utils";
// loadEnv, parse, withPortlessCors all removed

export default defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL!,
    redisUrl: process.env.REDIS_URL!,
    http: { storeCors: process.env.STORE_CORS!, /* ... */ },
  },
});
```

Two points the prior sketch did not make. **Removing `loadEnv()` is the change
that removes the silent failure** — with it gone, an unwrapped Medusa reads
nothing and crashes loudly. And the file must not import varlock, because ts-node
10.9.2 refuses ESM inside Medusa's synchronous `require()` (ADR-0012). Values
arrive through `varlock run` or through the `mze` CLI's injection.

`apps/medusa/src/portless.ts` is deleted, and its CORS patterns move into
`apps/medusa/.env.schema` as `if()` expressions.

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

The `dotenv.config({ path: "../../apps/storefront/.env" })` call goes, replaced
by `@import()` in `packages/db/.env.schema` or `varlock.loadPath` in
`packages/db/package.json`. All four `drizzle-kit` scripts gain
`varlock run --`. drizzle-kit has no varlock documentation, so this is the
generic external-tool path the JavaScript page describes.

### The `mze` CLI

The largest single decision, and the one the varlock docs do not cover.

**Option A — wrap the process.** Prefix the six root scripts:

```json
"scripts": {
  "mze": "varlock run -- node tooling/mze/main.ts",
  "dev": "varlock run -- node tooling/mze/main.ts dev",
  "build": "varlock run -- node tooling/mze/main.ts build",
  "test": "varlock run -- node tooling/mze/main.ts test",
  "test:e2e": "varlock run -- node tooling/mze/main.ts test e2e",
  "check": "varlock run -- node tooling/mze/main.ts check"
}
```

Every child inherits the injected values. One resolution for the whole tree.
Add `--inject vars` for the interactive subcommands so the `__VARLOCK_ENV` blob
does not sit in a long-lived shell environment.

**Option B — resolve inside the CLI.** `tooling/mze/services.ts` already returns
an `Environment` record and hands it to children. Replace the hand-written
URL templates with `varlock load --format json`, merge, and inject. This keeps
the six scripts unchanged and moves the URL composition into
`packages/env/.env.schema`, which is decision 9's win.

Option B costs one resolution per `mze` invocation, measured previously at
0.63–0.65 s. Option A costs the same and needs no code change. Both leave the
nine package scripts needing their own wrapper for direct invocation.

Two side effects of either option, both already recorded: a `bunfig.toml` with
`env = false` appears, and varlock's global `console` patch sits between
`tooling/mze`'s JSON output mode (`Output.Mode`) and stdout.

### CI

`.github/workflows/release.yml` gains a schema validation step, either
`varlock load` directly or
[`@varlock/varlock-github-action`](https://varlock.dev/integrations/github-action/).
No template-diff job, because there is no template.

---

## Remaining unknowns

- **`vite-plus` compatibility is untested.** The plugin imports nothing from
  `vite`, which is strong evidence it works. The peer range does not match
  `@voidzero-dev/vite-plus-core@0.2.6`. Nobody has run it.
- **Vite 8 is unmentioned.** The plugin declares `vite >=5` and develops against
  `vite ^7.1.0`. What breaks under a newer plugin container is unknown.
- **bun override of a transitive `dotenv` is undocumented.** The recipe has no
  bun tab. Whether `"dotenv": "npm:varlock"` in a bun root `overrides` block
  behaves like the npm form is untested.
- **`vite-plus` as a task runner is unmentioned.** The Turborepo strict-env
  warning suggests `vp run` must pass through the environment flag and the
  CI-detection variables. Whether `vp` filters the environment at all is not
  established here.
- **`node --import varlock/auto-load` is undocumented.** The bun preload recipe
  has no node counterpart in the docs. The module is a plain side-effect ESM
  import, so it is plausible, and it is not stated anywhere.
- **The `mze` CLI's JSON output under a patched global `console`.** `@redactLogs`
  defaults on and patches `console`. Whether `Output.Mode` JSON survives it is
  untested.
- **`@generateTsTypes` output reaching the Medusa `tsc` island.** The generated
  declaration file must land inside a `tsconfig` include path that ADR-0012
  keeps deliberately separate. Untested.
- **The `@defaultRequired=infer` mismatch** recorded in
  `varlock-evaluation.md` was not re-tested this pass. Version 1.16.1 is
  unchanged, so assume it still applies.
- **Resolution cost** was not re-measured. The prior figure of 0.63–0.65 s per
  resolution stands, against the same version.
