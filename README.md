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

The workspace uses the tool versions in [`mise.toml`](mise.toml). Install them.
Then install the workspace dependencies:

```sh
mise install
bun install
```

Start PostgreSQL and Redis:

```sh
bun run services:start
```

Copy both environment templates:

```sh
cp apps/storefront/.env.template apps/storefront/.env
cp apps/medusa/.env.template apps/medusa/.env
```

Push the Drizzle schema:

```sh
bun run db:push
```

Before you start Medusa directly, set `STRIPE_API_KEY` in `apps/medusa/.env`.

Start the development servers:

```sh
bun run dev
```

The Storefront runs at [http://localhost:3001](http://localhost:3001). The
Medusa admin runs at [http://localhost:9000/app](http://localhost:9000/app).

Portless is an optional path for local HTTPS development. It gives the
Storefront and Medusa stable URLs, but it does not isolate PostgreSQL or Redis.

```sh
bun add --global portless@0.15.5
bun run dev:portless
```

Read the [Portless integration note](docs/research/portless-integration.md) for
the URL and origin rules.

Before you submit a change, run the workspace gate:

```sh
bun run check
```

The main checks are also available on their own:

- `bun run build` — Build all applications.
- `bun run check-types` — Run the TypeScript check across the workspace.
- `bun run test` — Run the workspace and Medusa test suites.
- `bun run lint` — Run Oxlint.
- `bun run format` — Format the workspace with Oxfmt.

## Interfaces

The Medusa Store API is the only API surface. The Storefront calls Medusa under
`/store/*`.

- `http://localhost:3001` — Storefront for Shoppers.
- `http://localhost:9000/store/*` — Medusa Store API.
- `http://localhost:9000/app` — Medusa admin for Operators.

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
