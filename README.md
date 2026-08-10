<div align="center">
  <h1>MZE Store</h1>
  <p></p>
  <a href="https://github.com/hadronomy/mze-store/stargazers">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/github/stars/hadronomy/mze-store.svg?mode=dark">
      <img alt="GitHub stars" src="https://shieldcn.dev/github/stars/hadronomy/mze-store.svg?mode=light">
    </picture>
  </a>
  <a href="https://github.com/hadronomy/mze-store/issues">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/github/issues/hadronomy/mze-store.svg?mode=dark">
      <img alt="Open GitHub issues" src="https://shieldcn.dev/github/issues/hadronomy/mze-store.svg?mode=light">
    </picture>
  </a>
  <p></p>
  <p align="center">
    <strong>An online storefront for a physical shop in the Canary Islands.</strong><br />
    <sub>Medusa commerce, a TanStack Start Storefront, and a local development stack.</sub>
  </p>
  <p></p>
  <a href="#what-mze-store-does">Overview</a> •
  <a href="#development">Development</a> •
  <a href="#interfaces">Interfaces</a> •
  <a href="#local-stack">Local stack</a> •
  <a href="#documentation">Documentation</a>
  <hr />
</div>

## What MZE Store does

MZE Store sells from the Canary Islands into Spain and the wider EU. The
Storefront is the Shopper surface. Medusa owns commerce and the Operator admin.
Better Auth owns Account identity.

The workspace uses TypeScript, TanStack Start, Tailwind CSS, Drizzle, and Vite+.
Shared UI primitives live in `packages/ui`.

```mermaid
flowchart LR
  shopper(["Shopper"]) --> storefront["Storefront<br/>TanStack Start"]
  operator(["Operator"]) --> admin["Medusa admin<br/>/app"]

  storefront -->|"catalog + checkout"| api["Medusa Store API<br/>/store/*"]
  storefront -->|"Account session"| auth["Better Auth<br/>Account identity"]
  api --> commerce["Medusa commerce"]
  admin --> commerce

  commerce --> postgres[(PostgreSQL)]
  commerce --> redis[(Redis<br/>caching · event bus · workflow engine · locking)]

  classDef actor fill:#fff4d6,stroke:#9a6700,color:#3d2a00,stroke-width:1.5px;
  classDef surface fill:#e5f0ee,stroke:#2f6f65,color:#173e38,stroke-width:1.5px;
  classDef core fill:#f5e7d4,stroke:#9b5935,color:#4a281b,stroke-width:1.5px;
  classDef state fill:#e9ecef,stroke:#4c5b63,color:#25343b,stroke-width:1.5px;

  class shopper,operator actor;
  class storefront,admin surface;
  class api,auth,commerce core;
  class postgres,redis state;

  linkStyle default stroke:#6b625a,stroke-width:1.5px;
```

The Storefront keeps Account sessions separate from commerce credentials. The
Medusa backend uses Redis for caching, the event bus, the workflow engine, and
locking.

## Development

Use Mise to install the pinned Node and Bun versions:

```sh
mise install
```

Install the locked workspace dependencies:

```sh
bun install --frozen-lockfile
```

Create the application environment files from their committed templates:

```sh
cp apps/storefront/.env.template apps/storefront/.env
cp apps/medusa/.env.template apps/medusa/.env
```

Set a Stripe test secret in `apps/medusa/.env`. Then start PostgreSQL and Redis:

```sh
bun run services:start
```

Compose assigns a different host port to each worktree. Copy the ports from
`bun run services:ports` into the two environment files when they differ from
the template values.

Push the Account schema and install the Vite+ Git hooks:

```sh
bun run db:push
bun run hooks:setup
```

Install the pinned Portless version, then start both development servers:

```sh
bun add --global portless@0.15.5
bun run dev:portless
```

Portless gives the Storefront and Medusa stable local HTTPS URLs. Read the
[Portless integration note](docs/research/portless-integration.md) for the URL
and origin rules. Use `bun run dev` when fixed HTTP ports are required.

Run the workspace checks before you submit a change:

```sh
bun run check
bun run check-types
bun run test
```

`bun run test` needs PostgreSQL and Redis. The check and type-check commands do
not need the backing services.

Run the placeholder Chromium browser suite after you create the Account schema:

```sh
bunx playwright install chromium
bun run test:e2e
```

The placeholder does not start a browser flow yet. The configuration starts the
Storefront when `PLAYWRIGHT_BASE_URL` is not set, and it uses an existing server
when that variable is set.

The database commands are:

```sh
bun run db:push
bun run db:generate
bun run db:migrate
```

The Docker commands are:

```sh
bun run docker:build
bun run docker:up
bun run services:ports
bun run docker:logs
bun run docker:down
```

Discover application ports with:

```sh
docker compose port medusa 9000
docker compose port storefront 3001
```

Use `bun run build` to build all applications. Use `bun run lint` to run
Oxlint. Use `bun run format` to run Oxfmt.

## Interfaces

The Medusa Store API is the only API surface. The Storefront calls Medusa under
`/store/*`.

- Portless: `https://storefront.mze-store.localhost` — Storefront for Shoppers.
- Portless: `https://medusa.mze-store.localhost/store/*` — Medusa Store API.
- Portless: `https://medusa.mze-store.localhost/app` — Medusa admin for Operators.
- Compose: use `docker compose port storefront 3001` and
  `docker compose port medusa 9000` to find the HTTP URLs.

## Local stack

[`docker-compose.yml`](docker-compose.yml) defines the local development stack.
It includes the Storefront, Medusa, PostgreSQL, Redis, and the Medusa migration
job. It is not the production deployment target.

Before you start the full stack, set `STRIPE_API_KEY` in the shell or the
repository `.env` file.

Start the complete stack with:

```sh
bun run docker:up
```

Compose assigns project-scoped containers, volumes, and random loopback host
ports from the worktree directory. Run `bun run services:ports` and the
application port commands above to find the active ports.

View the stack:

```sh
bun run docker:logs
```

Stop the stack:

```sh
bun run docker:down
```

Production does not use this Compose file. [ADR-0006](docs/adr/0006-redis-from-the-first-deploy.md)
requires a small managed Redis instance. This repository does not define the
application hosting plan.

## Documentation

- [Architecture](docs/architecture.md)
- [Medusa backend guide](apps/medusa/README.md)
- [Architecture decisions](docs/adr/)
- [Roadmap](docs/roadmap.md)
- [Issue tracker guide](docs/agents/issue-tracker.md)
