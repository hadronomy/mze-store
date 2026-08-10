# Portless local development

Portless is an optional local development path for the Storefront and Medusa
HTTP servers. It gives each server a stable HTTPS URL and avoids HTTP port
conflicts between linked Git worktrees.

Each worktree gets its own PostgreSQL and Redis Compose project and volumes.
Run one Medusa revision against the services for that worktree.

## Install

Before you run the Portless commands, install the exact machine-wide version:

```sh
bun add --global portless@0.15.5
```

The development scripts run `portless --version` first. They stop when the
command is missing or the version is not `0.15.5`.

If Portless asks for elevated access on first use, approve the certificate
authority change. Portless creates a local certificate authority and adds it to
the system trust store. It uses HTTPS on port 443 and loopback access by default.

Do not install the Portless startup service. Do not enable LAN, Tailscale,
Funnel, ngrok, or wildcard routing for this pilot.

## Commands

Start the backing services in one terminal:

```sh
bun run services:start
```

If you run the apps directly, copy the host ports from `bun run services:ports`
into the two environment files before you start them.

In another terminal, start Medusa and the current Storefront:

```sh
bun run dev:portless
```

When the shared Medusa process is already running, start only the Storefront:

```sh
bun run dev:portless:storefront
```

When the session ends, stop the backing services:

```sh
bun run services:stop
```

The normal `bun run dev` command keeps the fixed-port path during the pilot.

## URLs

The Medusa process owns this stable URL:

```text
https://medusa.mze-store.localhost
```

The main worktree uses this Storefront URL:

```text
https://storefront.mze-store.localhost
```

Portless adds a worktree label to linked worktrees. For example:

```text
https://<worktree>.storefront.mze-store.localhost
```

Only one Medusa process can own `medusa.mze-store.localhost`. If another
worktree owns that route, the second Medusa command fails. Run
`bun run dev:portless:storefront` to start another Storefront without taking
the route.

## Origins

The Storefront receives its exact public URL in `PORTLESS_URL`. In local
development, the Account service uses that value for its base URL and trusted
origin. Production and CI keep their explicit environment URLs.

Medusa uses anchored CORS patterns for the Storefront worktree names and the
stable Medusa name. The patterns do not allow arbitrary `.localhost` origins.

## Limits

Portless only manages HTTP app processes. Docker Compose gives PostgreSQL,
Redis, and the HTTP services random loopback host ports for each Compose
project. The Compose project also scopes the service containers and volumes, so
linked worktrees do not share their state. Service-to-service traffic keeps the
stable names `postgres` and `redis`.

Portless is not part of CI or Docker Compose. After automated checks, a
two-worktree development session, and manual approval, promote it to the
normal `dev` path.
