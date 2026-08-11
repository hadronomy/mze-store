# Effect supervises repository commands

The repository has two different tooling concerns. Vite+ owns the workspace
task graph. Human workflows coordinate Vite+, Docker Compose, Portless, Medusa,
PostgreSQL, Redis, and long-lived child processes.

The current human workflows use package-script shell chains and small Node
programs. Their errors, signals, output, environment changes, and cleanup do not
share one model.

## Decision

Effect v4 owns repository command workflows and process supervision. Vite+
remains the only task runner.

The implementation lives in `tooling/mze/`. It runs on Node `24.18.1` through
native TypeScript stripping. Its TypeScript configuration permits only erasable
syntax and uses Node module resolution.

The first version pins this cohort:

- `effect@4.0.0-beta.107`
- `@effect/platform-node@4.0.0-beta.107`
- `@effect/vitest@4.0.0-beta.107`

The cohort moves as one exact-version update. The implementation does not use
the Effect v3 packages `@effect/cli` or `@effect/platform`.

Effect v4 CLI and child-process APIs use `effect/unstable/cli` and
`effect/unstable/process`. Repository-owned modules contain these imports. A
beta API change must not spread into workflow policy.

## Interface

The canonical entry is `bun run mze <command>`. The public command tree is:

```text
mze setup
mze doctor
mze dev [storefront]
mze build
mze check
mze test [e2e]
mze lint
mze format
mze services start|stop|status|ports
mze db push|generate|migrate|studio
mze auth schema
mze docker build|up|down|logs
```

The root keeps `dev`, `build`, `test`, and `check` as direct aliases. Each other
obsolete root script disappears after its replacement passes. Workspace scripts
that Vite+ needs remain implementation details.

Running `mze` without a command prints help and exits with `0`. Interactive
input starts only through `--wizard` or `mze setup`. CI never waits for input.

Human output is concise and aware of terminal color support. `--json` emits a
versioned NDJSON event stream. Child output becomes events, so raw output cannot
corrupt the stream.

One top-level reporter renders typed operational errors. The CLI renders parsing
and help. `NodeRuntime` renders defects and interruption. A failure appears once.

Exit codes have this contract:

- `0` for success
- `1` for an operational failure
- `2` for a usage error
- `127` when a required executable is missing
- `130` for `SIGINT`
- `143` for `SIGTERM`
- the exact child exit code for another child failure

## Module shape

Vertical modules own `dev`, `services`, `db`, `auth`, and `docker` workflows.
They use Effect platform seams for files, processes, standard I/O, terminals,
configuration, time, and tests.

A repository-specific module earns a seam only when it hides repository policy
or has two adapters. Human and NDJSON output are two adapters at one real seam.
The child-command module also earns its seam because it converts process results
into the shared exit and error contract.

The implementation does not wrap every helper in an Effect service. Small pure
functions stay local to the workflow that uses them.

## Development workflow

`dev` starts or reuses the worktree PostgreSQL and Redis services. It waits up
to 60 seconds for health. It injects the discovered ports into child-process
environments without editing environment files.

If health checks time out, the workflow stops before it starts the applications.
It leaves the services running and prints status and log commands.

One unexpected development-process exit stops its siblings. Effect scopes own
the child process groups and cleanup. A Portless route conflict never kills or
attaches to the route owner. The error gives the exact Storefront-only command.

`doctor` is read-only. It checks versions, executables, environment-file
presence, Docker, service health, Portless, and route ownership. It does not
read secret values.

`setup` can create a missing environment file from its template after terminal
confirmation. It never overwrites a file, installs a global tool, changes system
trust, or displays a secret. It does not write files without an interactive
terminal. JSON mode is read-only.

Data-loss operations require a flag that names the consequence, such as
`--accept-data-loss` or `--delete-volumes`. A generic `--yes` flag cannot approve
them.

## Verification and delivery

Deterministic tests use Effect test layers for processes, terminals, time,
configuration, and output. A small live suite runs on Ubuntu and macOS. It checks
signals, process-group cleanup, exit codes, and output channels.

The implementation proceeds as three stacked changes:

1. Effect runtime and Portless supervision.
2. The command tree, services, and development startup.
3. The remaining commands, aliases, and active documentation.

The first change must pass deterministic tests, both live operating-system jobs,
and a manual two-worktree session. A fixed waiting period does not replace these
behavior gates.

## Consequences

- Vite+ still owns caching, task ordering, formatting, linting, tests, and
  workspace builds.
- Effect gives human workflows one typed model for configuration, failures,
  resources, signals, output, and tests.
- The CLI and process imports can change before Effect v4 becomes stable. Exact
  pins and narrow repository modules contain that change.
- Node behavior is reproducible across local work and CI because both use one
  exact release.
- macOS and Linux are supported. Windows receives a clear unsupported-platform
  error until it has a real CI adapter.
- Active command documentation changes only when its command exists.

## Rejected alternatives

- A second task runner duplicates the Vite+ graph and cache policy.
- The published `@effect/cli` package belongs to the Effect v3 cohort.
- Commander and Clack reduce parser churn but add a second interaction model
  beside the Effect runtime.
- Execa, zx, ora, and listr2 duplicate process or output behavior that Effect v4
  already supplies.
- One large migration replaces working commands before the beta runtime
  proves its process behavior.

## Related

- [Effect tooling research](../research/effect-tooling-scripts.md)
- ADR-0001 — Medusa runs under Bun workspaces, with Node as the runtime.
- ADR-0012 — the Medusa backend is a tsc island in a Vite+ workspace.
