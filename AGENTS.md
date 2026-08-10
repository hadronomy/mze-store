# MZE Store repository guide

Read [`CONTEXT.md`](./CONTEXT.md) before you change code. Use its terms in
code, tests, commits, and documentation. Read [`docs/architecture.md`](./docs/architecture.md)
and the relevant records in [`docs/adr/`](./docs/adr/) before you change a
boundary.

## Toolchain

- Mise pins Node 24 and Bun 1.3.14 in [`mise.toml`](./mise.toml).
- Bun is the package manager. Node runs Medusa and the other Node processes.
- Vite+ owns formatting, linting, tests, staged checks, and workspace tasks.
- Oxlint and Oxfmt use [`vite.config.ts`](./vite.config.ts).
- Medusa uses Jest for its integration tests. Other workspace tests use Vitest.

## Commands

Run these commands from the repository root:

```sh
bun install --frozen-lockfile
bun run check
bun run check-types
bun run test
bun run hooks:setup
bun run services:start
bun run services:stop
bun run dev:portless
bun run docker:up
bun run docker:down
```

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
- `node_modules/` and `.cache/`
- `.vite-hooks/`
- `test-results/` and `playwright-report/`

Compose uses the worktree directory as its project name by default. Use
`docker compose port <service> <container-port>` to find a random host port.

## Further guidance

- Read [`docs/agents/domain.md`](./docs/agents/domain.md) for the domain map.
- Read [`docs/agents/issue-tracker.md`](./docs/agents/issue-tracker.md) before
  you create or update an issue.
- Keep generated files and local environment files out of commits.
