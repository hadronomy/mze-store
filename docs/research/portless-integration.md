# Portless local development

Portless is an optional local development path for the Storefront and Medusa
HTTP servers. It gives each server a stable HTTPS URL and avoids HTTP port
conflicts between linked Git worktrees.

Each worktree gets its own PostgreSQL and Redis Compose project and volumes.
Portless gives linked Storefront processes worktree-specific names, but the
Medusa development script uses one shared stable name. Run one Medusa process
at a time on that name. A second worktree can run its Storefront only, or run
Medusa on a discovered Compose port with that worktree's environment file.

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

Start the backing services without starting the applications:

```sh
bun run mze services start
```

Start Medusa and the current Storefront. The command discovers and injects the
service ports in memory:

```sh
bun run dev
```

When the shared Medusa process is already running, start only the Storefront:

```sh
bun run mze dev storefront
```

When the session ends, stop the backing services:

```sh
bun run mze services stop
```

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
`bun run mze dev storefront` to start another Storefront without taking
the route. To use the second worktree's isolated database and Redis, start its
Compose Medusa service with `docker compose up -d medusa`. Discover its port
with `docker compose port medusa 9000`, then point that Storefront's Medusa URL
at the discovered port.

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
linked worktrees do not share database or Redis state. Service-to-service
traffic keeps the stable names `postgres` and `redis`. The shared Portless
Medusa name is an application-route limit, not a Compose-state limit.

Portless is not part of Docker Compose. The Effect tooling checks its exact
version and supervises its child processes on macOS and Linux.
