# MZE Store

This project was created with [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack), a modern TypeScript stack that combines React, TanStack Start, Self, ORPC, and more.

## Features

- **TypeScript** - For type safety and improved developer experience
- **TanStack Start** - SSR framework with TanStack Router
- **TailwindCSS** - Utility-first CSS for rapid UI development
- **Shared UI package** - shadcn/ui primitives live in `packages/ui`
- **oRPC** - End-to-end type-safe APIs with OpenAPI integration
- **Drizzle** - TypeScript-first ORM
- **PostgreSQL** - Database engine
- **Authentication** - Better-Auth
- **Oxlint** - Oxlint + Oxfmt (linting & formatting)
- **Vite+** - Unified Vite toolchain, workspace task runner, linting, and formatting

## Getting Started

First, install the dependencies:

```bash
bun install
```

## Database Setup

This project uses PostgreSQL with Drizzle ORM.

1. Make sure you have a PostgreSQL database set up.
2. Copy the Storefront environment template:

```bash
cp apps/storefront/.env.template apps/storefront/.env
```

Update `DATABASE_URL` in the new file if the database does not use the local Compose defaults.

3. Apply the schema to your database:

```bash
bun run db:push
```

Then, run the development server:

```bash
bun run dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser to see the fullstack application.

### Portless development

Portless is an optional path for local HTTP development. It gives the
Storefront and Medusa stable HTTPS URLs, including worktree-specific
Storefront URLs. It does not isolate PostgreSQL or Redis.

Before you use Portless, install the pinned machine-wide version:

```bash
bun add --global portless@0.15.5
```

Start the backing services:

```bash
bun run services:start
```

Then start the Portless development path:

```bash
bun run dev:portless
```

Read the [Portless integration note](docs/research/portless-integration.md)
for the URL and origin rules.

## UI Customization

React web apps in this stack share shadcn/ui primitives through `packages/ui`.

- Change design tokens and global styles in `packages/ui/src/styles/globals.css`
- Update shared primitives in `packages/ui/src/components/*`
- Adjust shadcn aliases or style config in `packages/ui/components.json` and `apps/storefront/components.json`

### Add more shared components

Run this from the project root to add more primitives to the shared UI package:

```bash
npx shadcn@latest add accordion dialog popover sheet table -c packages/ui
```

Import shared components like this:

```tsx
import { Button } from "@mze-store/ui/components/button";
```

### Add app-specific blocks

If you want to add app-specific blocks instead of shared primitives, run the shadcn CLI from `apps/storefront`.

## Deployment

### Docker Compose

- Target: web + server
- Config: `docker-compose.yml` (app Dockerfiles live in `apps/*/Dockerfile`)
- Build images: bun run docker:build
- Start: bun run docker:up
- Logs: bun run docker:logs
- Stop: bun run docker:down

Environment variables are read from each app's `.env` file (baked into web builds for public variables) and overridden in `docker-compose.yml` for container networking.

For more details, see the guide on [Deploying with Docker Compose](https://www.better-t-stack.dev/docs/guides/docker).

## Git Hooks and Formatting

- Optional native Vite+ hooks: `bun run hooks:setup`
- Docs: [Vite+ commit hooks](https://viteplus.dev/guide/commit-hooks)
- Run checks: `bun run check`

## Project Structure

```
mze-store/
├── apps/
│   ├── medusa/      # Commerce backend + admin (Medusa v2)
│   └── storefront/  # Storefront (React + TanStack Start)
├── packages/
│   ├── ui/          # Shared shadcn/ui components and styles
│   ├── auth/        # Authentication configuration & logic
│   ├── config/      # Shared tsconfig presets
│   ├── env/         # Validated environment
│   └── db/          # Database schema & queries
```

`docs/architecture.md` describes the shape in full, and `apps/medusa/README.md`
covers running the backend.

## Available Scripts

- `bun run dev`: Start all applications in development mode
- `bun run dev:portless`: Start Medusa and the Storefront through Portless
- `bun run dev:portless:storefront`: Start the Storefront through Portless
- `bun run build`: Build all applications
- `bun run dev:storefront`: Start only the storefront
- `bun run check-types`: Check TypeScript types across all apps
- `bun run test`: Run every app's test suite (currently `apps/medusa` only)
- `bun run db:push`: Push schema changes to database
- `bun run db:generate`: Generate database client/types
- `bun run db:migrate`: Run database migrations
- `bun run db:studio`: Open database studio UI
- `bun run check`: Run Vite+ format/lint checks and workspace TypeScript checks
- `bun run lint`: Run Vite+ lint checks
- `bun run format`: Run Vite+ formatting
- `bun run staged`: Run Vite+ checks against staged files
- `bun run hooks:setup`: Install Vite+ native Git hooks with `vp config`
- `bun run docker:build`: Build the Docker Compose images
- `bun run docker:up`: Build and start the Docker Compose stack
- `bun run docker:logs`: Tail logs from the Docker Compose stack
- `bun run docker:down`: Stop the Docker Compose stack
- `bun run services:start`: Start PostgreSQL and Redis
- `bun run services:stop`: Stop PostgreSQL and Redis
