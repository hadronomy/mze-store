# Effect v4 for project tooling scripts

**Date checked:** 2026-08-11

**Scope:** Repository-local development and operations scripts

## Result

Effect v4 can give these scripts one typed lifecycle model. It can cover
configuration, errors, child processes, signals, terminal input, logs, and tests.

The current v4 release is still beta. Its CLI and child-process modules also
use `unstable` import paths. The best first step is a narrow vertical slice.
Do not move every package script into one new framework at once.

Use this initial package set:

| Package                 | Exact version                     | Use                                                                                   |
| ----------------------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| `effect`                | `4.0.0-beta.107`                  | Effects, Schema, Config, logs, terminal services, CLI, and child-process descriptions |
| `@effect/platform-node` | `4.0.0-beta.107`                  | Node runtime, process spawning, file system, path, standard I/O, and terminal layers  |
| `@effect/vitest`        | `4.0.0-beta.107`                  | Effect-aware tests on the Vitest version that Vite+ already locks                     |
| `ioredis`               | Existing catalog version `5.11.1` | Satisfies the required peer of `@effect/platform-node`                                |

Pin the three Effect packages to one exact beta. Do not use a caret range.
Effect published all three beta packages from the same repository commit.
[Effect v4 package](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/package.json),
[Node platform package](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/platform-node/package.json)

Pin `@effect/vitest@4.0.0-beta.107` with the same cohort. Introduce its test
helpers after the first runtime script works end to end. Its peer range accepts
Vitest 4.1, and Vite+ 0.2.6 locks Vitest 4.1.10 in [`bun.lock`](../../bun.lock).
Keep `vp test` as the test command.
[`@effect/vitest` package](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/vitest/package.json)

## Accepted design

The grilling session accepted this design on 2026-08-11.

- Pin `effect`, `@effect/platform-node`, and `@effect/vitest` to
  `4.0.0-beta.107`. Move the complete cohort in one automated update.
- Pin Node `24.18.1` in Mise and CI. Run the tooling source with native Node
  TypeScript stripping and an erasable, Node-specific TypeScript configuration.
- Support macOS and Linux. Return a clear unsupported-platform error on Windows.
- Keep Vite+ as the only task runner. Effect owns human workflows, typed errors,
  child-process lifecycles, terminal interaction, and output.
- Put the implementation in `tooling/mze/`. Organize it by vertical workflows,
  with small shared infrastructure and one top-level failure reporter.
- Make `bun run mze <command>` the canonical interface. Keep only `dev`,
  `build`, `test`, and `check` as direct root aliases.
- Use concise terminal output by default. Use versioned NDJSON lifecycle events
  for `--json`, including wrapped child output on separate output streams.
- Print help and exit successfully when `mze` has no command. Require
  `--wizard` or `mze setup` before the program can prompt.
- Let `mze doctor` inspect without making changes. Let `mze setup` create only
  missing environment files after interactive confirmation.
- Let `dev` start or reuse PostgreSQL and Redis, wait 60 seconds for health,
  inject discovered ports in memory, and leave the services running.
- Stop all sibling development processes after one unexpected exit. Preserve
  child exit codes and map signals to `130` and `143`.
- Require explicit consequence flags for data-loss operations. Do not use a
  generic `--yes` flag.
- Test deterministic behavior with Effect test layers. Run a small live process
  suite on Ubuntu and macOS.
- Deliver three stacked changes: Portless runtime, services and development,
  then remaining commands and documentation.

[ADR-0023](../adr/0023-effect-supervises-repository-commands.md) records the
accepted architecture.

Do not install these v3 packages:

- `@effect/platform`
- `@effect/cli`
- `@effect/printer`
- `@effect/printer-ansi`

Effect v4 puts the platform-neutral services in `effect`. It puts the new CLI
in `effect/unstable/cli`. The published `@effect/cli@0.77.0` requires Effect
3.22.1 and the v3 platform and printer packages.
[Effect v4 exports](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/package.json#L30-L53),
[`@effect/cli@0.77.0` registry manifest](https://registry.npmjs.org/@effect%2fcli/0.77.0)

Use this v4 mapping when reading v3 examples:

| v3 surface                  | v4 surface                                      |
| --------------------------- | ----------------------------------------------- |
| `@effect/platform/Command`  | `effect/unstable/process/ChildProcess`          |
| `CommandExecutor`           | `ChildProcessSpawner`                           |
| `NodeCommandExecutor`       | `@effect/platform-node/NodeChildProcessSpawner` |
| `@effect/platform/Terminal` | `effect/Terminal`                               |
| `@effect/cli`               | `effect/unstable/cli`                           |

The v4 process index exports only `ChildProcess` and `ChildProcessSpawner`.
The Node adapter exports `NodeChildProcessSpawner`, `NodeTerminal`,
`NodeRuntime`, and the aggregate `NodeServices` layer.
[v4 process index](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/unstable/process/index.ts),
[v4 Node exports](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/platform-node/src/index.ts)

## Release and maturity check

The npm distribution tags gave these values on 2026-08-11:

| Surface                   | Stable npm tag                | v4 tag                     | Maturity for this design               |
| ------------------------- | ----------------------------- | -------------------------- | -------------------------------------- |
| `effect`                  | `3.22.1`                      | `4.0.0-beta.107` on `beta` | v4 beta                                |
| `@effect/platform-node`   | `0.108.1` for Effect v3       | `4.0.0-beta.107` on `beta` | v4 beta                                |
| `@effect/vitest`          | `0.30.0` for Effect v3        | `4.0.0-beta.107` on `beta` | v4 beta                                |
| `@effect/opentelemetry`   | `0.64.0` for Effect v3        | `4.0.0-beta.107` on `beta` | v4 beta, optional                      |
| `effect/unstable/cli`     | Part of the Effect v4 package | No separate tag            | Experimental API inside a beta package |
| `effect/unstable/process` | Part of the Effect v4 package | No separate tag            | Experimental API inside a beta package |

There was no Effect v4 RC tag. The latest stable `effect` tag still selected
v3. The beta was published on 2026-08-10.
[Effect registry metadata](https://registry.npmjs.org/effect),
[Node platform registry metadata](https://registry.npmjs.org/@effect%2fplatform-node),
[`@effect/vitest` registry metadata](https://registry.npmjs.org/@effect%2fvitest),
[`@effect/opentelemetry` registry metadata](https://registry.npmjs.org/@effect%2fopentelemetry)

The `unstable` label is part of the public export path. This label makes API
change risk explicit even if the surrounding v4 package reaches a stable release.
[Effect export map](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/package.json#L30-L53)

## Current repository inventory

The repository does not contain `effect` or an `@effect/*` package. The root
has 28 package scripts. The workspaces add 26 more scripts.
[Root scripts](../../package.json),
[Medusa scripts](../../apps/medusa/package.json),
[Storefront scripts](../../apps/storefront/package.json)

The current tooling code has these boundaries:

| Boundary                                | Current form                     | Main concern                                                    |
| --------------------------------------- | -------------------------------- | --------------------------------------------------------------- |
| Build, check, test, and workspace order | Vite+ commands in `package.json` | This is the task graph and must remain Vite+                    |
| Docker service lifecycle                | Shell strings with `&&`          | Exit behavior and output have no shared model                   |
| Portless version check                  | Synchronous Node child process   | Typed failures exist only as thrown `Error` values              |
| Portless Medusa supervisor              | Event-based Node child process   | It owns signal forwarding, output capture, and exit translation |
| Test global setup                       | Synchronous Node child process   | It mutates global `PATH` and repeats process setup logic        |
| Medusa seed and probe                   | Medusa `exec` entry points       | Medusa owns their entry contract and container                  |
| Custom Oxlint rule                      | Vite+ JavaScript plugin          | This is plugin code, not a project command                      |

The source boundaries are in [`tooling/`](../../tooling/). The two Medusa
entry points are in [`apps/medusa/src/scripts/`](../../apps/medusa/src/scripts/).

The project pins Node 24 and Bun 1.3.14. Bun is the package manager, and Node
runs scripts and applications. Vite+ owns workspace tasks and checks.
[`mise.toml`](../../mise.toml), [`AGENTS.md`](../../AGENTS.md)

This redesign must not create a second task runner. The Effect program can be
the human command surface and process supervisor. Vite+ must still own task
ordering, caching, formatting, linting, and tests.

## What Effect v4 gives the scripts

### Main program and Node services

`NodeRuntime.runMain` handles error reporting, exit codes, `SIGINT`, and
`SIGTERM`. `NodeServices.layer` supplies Node child processes, file system,
path, standard I/O, terminal, and crypto services.
[Node runtime source](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/platform-node/src/NodeRuntime.ts),
[Node services source](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/platform-node/src/NodeServices.ts)

This removes the manual signal listeners in
[`tooling/portless/medusa.mjs`](../../tooling/portless/medusa.mjs). It also
gives each long-lived child process a scope.

### Child processes

`ChildProcess.make` accepts an argument array or a template form. A command can
set its working directory, environment, standard streams, termination signal,
and force-kill timeout. Commands can also form pipelines.
[Child-process API](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/unstable/process/ChildProcess.ts#L421-L934)

The Node implementation uses scoped acquisition. It terminates a referenced
process group when the scope closes. It can send `SIGTERM` and then `SIGKILL`
after a configured timeout.
[Node child-process implementation](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/platform-node-shared/src/NodeChildProcessSpawner.ts#L400-L548)

Three details need a repository adapter:

1. A nonzero child exit code is a value. It does not fail the Effect by itself.
2. An explicit `env` replaces the inherited environment unless `extendEnv` is true.
3. Non-Windows children are detached by default, so process-group behavior needs integration tests.

The adapter must convert nonzero exit codes into one typed `CommandFailed`
error. It must also select output behavior for each command.
[Child-process options](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/unstable/process/ChildProcess.ts#L265-L382)

Use inherited standard streams for development servers and Docker logs. Use a
bounded captured stream only when code must inspect output, such as the
Portless route-conflict check. Do not keep an unbounded session transcript in
one string.

### CLI and terminal UX

The v4 CLI supports typed arguments, flags, defaults, aliases, subcommands,
shared flags, custom help output, and Schema-based validation.
[Command API](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/unstable/cli/Command.ts),
[flag API](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/unstable/cli/Flag.ts),
[argument API](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/unstable/cli/Argument.ts)

The default global flags provide help, version output, a command wizard, shell
completions, and a log-level setting. Completions support Bash, Zsh, Fish, and
`sh` as a Bash alias.
[Global flags](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/unstable/cli/GlobalFlag.ts#L119-L315)

The prompt module includes confirm, text, password, file, select,
autocomplete, multi-select, date, integer, float, list, and toggle prompts.
Cancellation uses a typed `Terminal.QuitError`.
[Prompt API](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/unstable/cli/Prompt.ts),
[Terminal service](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Terminal.ts)

Prompts must be explicit. CI and normal package scripts must never wait for
input. Use `--wizard` or a named interactive command to enter prompt mode.

The default help formatter detects a TTY and disables color when
`NO_COLOR=1`. Tests can install a formatter with colors disabled.
[CLI formatter](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/unstable/cli/CliOutput.ts#L298-L370)

### Configuration and Schema

Effect `Config` values are typed recipes that can read a provider and fail
with `ConfigError`. Effect v4 includes environment, `.env`, directory, and
unknown-object providers. It also supports defaults, optional values, nested
keys, and Schema decoding.
[Config source](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Config.ts),
[ConfigProvider source](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/ConfigProvider.ts)

Use Config only for the tooling program's own environment. Do not replace the
existing application environment package in the first change. Use
`Config.redacted` or a redacted CLI argument for credentials.

CLI flags and arguments can apply Schema constraints. They can also fall back
to Config or an explicit prompt.
[Flag Schema and fallbacks](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/unstable/cli/Flag.ts),
[argument Schema and fallbacks](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/unstable/cli/Argument.ts)

### Logs and traces

Effect core supplies structured log levels, annotations, log spans, and
tracing spans. Logger output can use pretty, logfmt, structured, or JSON
formats.
[Effect logging operations](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Effect.ts#L13620-L14066),
[Logger formats](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/Logger.ts#L340-L697)

Use concise human output on a terminal. Use structured output only for CI or a
diagnostic flag. Annotate child commands with the command name and elapsed
time. Do not log environment values or credentials.

Do not add `@effect/opentelemetry` in the first stage. The package is beta and
needs OpenTelemetry SDK peers. Add it only when a real collector and trace
consumer exist.
[`@effect/opentelemetry` registry manifest](https://registry.npmjs.org/@effect%2fopentelemetry/4.0.0-beta.107)

### Tests

`@effect/vitest` adds `it.effect`, `it.live`, layer fixtures, and property
tests. Its own v4 tests use service layers for standard I/O, terminal input,
file system, process spawning, and CLI output.
[`@effect/vitest` API](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/vitest/src/index.ts),
[Effect CLI tests](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/test/unstable/cli/Command.test.ts)

Keep most tests free of real processes. Provide test layers for arguments,
terminal events, output, and child-process results. Keep a small live suite for
signal forwarding and process-group cleanup on Ubuntu and macOS.

## Architecture options

### Option A: Effect runtime under the current command surface

Keep all current package-script names. Replace only their implementation
modules with Effect programs. Start with the Portless version check and Medusa
supervisor.

This option gives typed errors, scoped child processes, and deterministic
tests. It does not depend on the unstable CLI parser. Package scripts still
contain some shell orchestration.

**Risk:** Low relative to the other Effect v4 options. The child-process API is
still unstable.

### Option B: One repository command with Effect CLI

Create one Node entry point with commands such as `services start`, `services
stop`, `services ports`, `dev`, and `dev storefront`. Keep `bun run` scripts as
short aliases to this command.

This option gives one help tree, completions, consistent errors, and optional
wizard flows. It also removes repeated shell chains from `package.json`.

Vite+ remains behind the boundary for build, check, test, and cached workspace
tasks. The new command coordinates human workflows and long-lived processes.

**Risk:** Medium to high. Both Effect v4 and its CLI API can change before a
stable release.

### Option C: Stable CLI parser with an Effect runtime

Commander 15.0.0 is stable, has no runtime dependencies, and requires Node
22.12 or newer. It supplies strict parsing, subcommands, help, and TypeScript
types. `@clack/prompts` 1.7.0 is stable and requires Node 20.12 or newer. It
adds styled prompts, spinners, and progress output.
[Commander manifest](https://registry.npmjs.org/commander/15.0.0),
[Commander documentation](https://github.com/tj/commander.js/blob/ba6d13ddb4243e5913367734f8c159089ffe7834/Readme.md),
[`@clack/prompts` manifest](https://registry.npmjs.org/@clack%2fprompts/1.7.0),
[`@clack/prompts` documentation](https://github.com/bombshell-dev/clack/tree/main/packages/prompts)

This option reduces parser churn. It creates an adapter between Promise-based
CLI code and the Effect error and cancellation model. It also duplicates v4
CLI and prompt features.

**Risk:** Medium. The packages are stable, but the integration has more seams.

## Recommendation

Use Option A as the first working layer. Option B is the accepted public
surface after that layer passes the lifecycle gates.

The first vertical slice must cover `portless:check` and the Portless Medusa
supervisor. These files contain the current process, signal, exit, and output
concerns. They give a useful test of the Effect value without changing
application code.

Do not convert these boundaries in the first slice:

- Vite+ workspace task definitions
- The Oxlint plugin
- Medusa seed entry points
- Application environment validation
- Medusa build, migrate, or test commands

Medusa must continue to call its own `exec` entry points. The tooling command
can start Medusa, but it must not replace Medusa's loader or container contract.
[`ADR-0012`](../adr/0012-the-medusa-backend-is-a-tsc-island.md)

## Staged direction

### Layer 1: runtime and Portless

1. Pin the tested Effect beta cohort and Node `24.18.1`.
2. Add the native TypeScript entry and the shared child-command adapter.
3. Port the Portless version check and Medusa supervisor.
4. Add deterministic tests and live process-lifecycle tests.
5. Run a manual two-worktree session before the next layer.

### Layer 2: services and development

1. Add the `mze` command tree, output adapters, and top-level failure reporter.
2. Add `setup`, `doctor`, `services`, and `dev`.
3. Start or reuse PostgreSQL and Redis, wait for health, and inject ports in memory.
4. Add the four direct aliases only when their replacement commands pass.

### Layer 3: remaining commands and documentation

1. Add `build`, `check`, `test`, `lint`, `format`, `db`, `auth`, and `docker`.
2. Make `check` run the fast pull-request gate through Vite+.
3. Remove each obsolete root script after its replacement passes.
4. Update active command documentation for commands that now exist.
5. Keep all workspace build and check tasks in Vite+.

Recheck the exact Effect beta before each layer. Update the cohort together.

Node can run TypeScript with erasable syntax. This support became stable in
Node 24.12. Node ignores `tsconfig.json` during type stripping.
[Node TypeScript documentation](https://nodejs.org/download/release/v24.12.0/docs/api/typescript.html)

The repository currently pins only the Node major. Pin Node `24.18.1` before
the tooling entry relies on stable type stripping. Use relative imports with
explicit extensions. Keep `vp check-types` as the type check.
[Node 24 release directory](https://nodejs.org/download/release/latest-v24.x/)

## Acceptance gates

The vertical slice is ready only when all these facts are true:

1. A failed child command returns its exact exit code.
2. `Ctrl+C` closes the complete child process group.
3. `SIGTERM` behaves the same in a container and a local terminal.
4. CI never waits for terminal input.
5. Normal child output streams without unbounded buffering.
6. Error text appears once and goes to standard error.
7. Help and version output go to standard output.
8. `NO_COLOR=1` produces plain output.
9. Tests do not mutate global environment or standard streams.
10. A root command name disappears only after its replacement passes.
11. Vite+ remains the only task runner.
12. `bun run check`, `bun run check-types`, and the relevant tests pass.

One error renderer must own each failure. `Command.run` can render a CLI error
and then rethrow it. `NodeRuntime.runMain` can also report an unhandled failure.
Select one owner and add a regression test for duplicate output.
[Command error rendering](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/effect/src/unstable/cli/Command.ts#L1750-L1967),
[Node main runner](https://github.com/Effect-TS/effect/blob/3c495ae7c96d43bfc3b8020250562a194c2c895e/packages/platform-node-shared/src/NodeRuntime.ts)

## Main risks

| Risk                                                     | Control                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| Beta APIs change often                                   | Exact pins, one cohort, small stages, no compatibility layer               |
| `unstable` CLI and process APIs change after v4 stable   | Keep domain workflows behind repository-owned adapters                     |
| Nonzero child exit codes look successful                 | Convert them to one typed error at the adapter boundary                    |
| A process survives cancellation                          | Use scopes and live process-group tests                                    |
| Error output appears twice                               | Give rendering to one boundary and test standard error                     |
| Interactive output breaks CI                             | Require an explicit interactive mode and inspect TTY state                 |
| A second task runner emerges                             | Keep all task graphs and caches in Vite+                                   |
| Node type stripping ignores `tsconfig.json`              | Use erasable syntax and explicit relative imports                          |
| `@effect/platform-node` peer resolution changes the lock | Add the existing `ioredis` version as a direct root development dependency |

## Package decision summary

| Package                                | Decision                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------- |
| `effect@4.0.0-beta.107`                | Adopt in the first vertical slice                                             |
| `@effect/platform-node@4.0.0-beta.107` | Adopt with Effect                                                             |
| `@effect/vitest@4.0.0-beta.107`        | Pin with the first cohort. Use after the runtime script works under `vp test` |
| `@effect/opentelemetry@4.0.0-beta.107` | Defer until a collector exists                                                |
| `@effect/cli@0.77.0`                   | Reject because it requires Effect v3                                          |
| `@effect/platform@0.97.1`              | Reject because it is the v3 platform package                                  |
| `@effect/printer*`                     | Reject because the published packages belong to the v3 CLI cohort             |
| `commander@15.0.0`                     | Stable fallback if the v4 CLI churn is unacceptable                           |
| `@clack/prompts@1.7.0`                 | Optional stable prompt fallback, not part of the initial set                  |
| `execa`, `zx`, `ora`, `listr2`         | Do not add in the first design because Effect covers the required boundary    |

The smallest sound design uses Effect and the Node adapter only. It keeps the
repository's current task runner and application boundaries. It also leaves a
clear path to one polished command after the beta earns that wider role.
