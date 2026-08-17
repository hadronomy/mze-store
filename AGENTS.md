# MZE Store repository guide

Read [`CONTEXT.md`](./CONTEXT.md) before you change code. Use its terms in
code, tests, commits, and documentation. Read [`docs/architecture.md`](./docs/architecture.md)
and the relevant records in [`docs/adr/`](./docs/adr/) before you change a
boundary.

## Toolchain

- Mise pins Node 24.18.1 and Bun 1.3.14 in [`mise.toml`](./mise.toml).
- Bun is the package manager. Node runs Medusa and the other Node processes.
- Vite+ owns formatting, linting, tests, staged checks, and workspace tasks.
- Oxlint and Oxfmt use [`vite.config.ts`](./vite.config.ts).
- Medusa uses Jest for its integration tests. Other workspace tests use Vitest.

## Commands

Run these commands from the repository root:

```sh
bun install --frozen-lockfile
bun run mze setup
bun run mze doctor
bun run dev
bun run check
bun run test
bun run mze services start
bun run mze services stop
bun run mze docker up
bun run mze docker down
```

`bun install` runs `effect-language-service patch`, which patches the installed
typescript so Effect diagnostics appear under `tsc` and not only in an editor.
`mze check` typechecks `tooling/mze/` with them through its `tooling types`
phase. The patch is a no-op where the tool is absent, such as the production
image install.

`bun run build`, `bun run check`, and `mze lint` report one row per phase and
keep each task's output unless it fails. Pass `--verbose` for the full output,
or `--json` for the NDJSON event stream. See
[ADR-0027](docs/adr/0027-batch-commands-report-phase-rows.md).

`bun run test` and direct Medusa development need PostgreSQL and Redis. Copy
`apps/storefront/.env.template` and `apps/medusa/.env.template` before you run
the applications. Use a Stripe test secret in the Medusa environment file.

## Invariants

- Medusa owns commerce and the Operator admin.
- Better Auth owns Account identity and sessions.
- The Storefront calls the Medusa Store API under `/store/*`.
- The database owns the Territory model after its first Declaration.
- The ERP owns true stock and issues Invoices. Commerce delivers issued Invoices.
- A Cart is mutable. An Order is immutable after placement.
- Do not add a second task runner, formatter, linter, or Git hook manager.

## Generated paths

Do not edit generated output. The root Vite+ config ignores these paths:

- `apps/storefront/dist/`
- `apps/storefront/.vinxi/`
- `apps/storefront/.tanstack/`
- `apps/storefront/.output/`
- `apps/storefront/src/routeTree.gen.ts`
- `apps/medusa/.medusa/`
- `packages/*/dist/`
- `tooling/oxlint/dist/`
- `node_modules/` and `.cache/`
- `.vite-hooks/`
- `test-results/` and `playwright-report/`

Compose uses the worktree directory as its project name by default. Use
`docker compose port <service> <container-port>` to find a random host port.

The Knip report is not a required check. Run
`bunx knip --no-exit-code --reporter compact` when you
change workspace entries or dependencies. Package builds and package type
checks use the cached Vite+ tasks through `bun run build` and `bun run check`.
Do not add database, migration, seed, test,
development-server, or application-build scripts to cached task definitions.

## Further guidance

- Read [`docs/agents/domain.md`](./docs/agents/domain.md) for the domain map.
- Read [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md) before
  you create or update an issue.
- Keep generated files and local environment files out of commits.
