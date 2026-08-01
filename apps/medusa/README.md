# Medusa backend

Generated with `create-medusa-app` and adapted to this workspace. Installed by
bun, executed by node — [ADR-0001](../../docs/adr/0001-medusa-under-bun-workspaces-on-node.md)
lists the four dependency requirements that produce misleading errors when
missed. It is the one surface here that builds with tsc and emits CommonJS;
[ADR-0012](../../docs/adr/0012-the-medusa-backend-is-a-tsc-island.md) explains
why it is neither bundled nor bundle-able.

## Running it

```sh
docker compose up -d postgres redis    # from the repo root
cp .env.template .env
bun run db:migrate
bun run user:create -e you@example.com -p yourpassword
bun run dev                            # admin at http://localhost:9000/app
```

Or `docker compose up medusa` from the root to run the whole thing in
containers, migrations included.

Go through `bun run`, not the `medusa` binary directly: bun links it into this
package's own `node_modules/.bin`, never the workspace root (ADR-0001), so a
path guessed from the root will not resolve. `bun run` still executes it under
node — bun is the package manager here, not the runtime.

`medusa develop` runs from this directory. `medusa start` — what the Docker
image runs — runs from `.medusa/server`, because that is where the compiled
config and the admin bundle live. Starting it from the wrong one fails with
"Could not find index.html in the admin build directory", which is why
`bun run start` is only meaningful after a build, from that directory.

## Tests

```sh
bun run test
```

Jest, because Medusa's test utilities are jest-based and this app is a CJS
island. The storefront will use vitest when it has tests; the two runners are
deliberately not unified, and both run under `vp run -r test` — see ADR-0012.

`integration-tests/http/` is the seam every later phase extends:
`medusaIntegrationTestRunner` boots the real app against a real database, so a
passing suite is proof that the backend builds, migrates, and serves. It needs
Postgres and Redis up, and it creates and drops a database per jest worker.

Note that the runner disables the admin dashboard, so `/app` is not reachable
from a test. That one is verified by running the thing.

`ioredis` is pinned to the exact version Medusa resolves, for the same reason
ADR-0001 forbids declaring `@mikro-orm/*`: the test client and the modules under
test should be talking to Redis through one copy of the driver, not two.

## React is pinned to 18

`@medusajs/dashboard` — the admin UI the bundler pulls in — requires React 18,
so the admin bundle cannot use the workspace catalog's React 19. The two never
meet: this app and the storefront resolve their own copies.

`@medusajs/dashboard` looks unused — nothing here imports it — but it is a fifth
member of ADR-0001's list of dependencies you must declare anyway. The generated
admin entry does `@import "@medusajs/dashboard/css"`, resolved from this
directory rather than from the bundler's, so under bun's isolated layout dropping
it fails the build with `ENOENT ... '@medusajs/dashboard/css'`. It also owns the
React 18 constraint. `@medusajs/admin-shared` is declared alongside it.

Admin extensions will additionally want `@medusajs/ui` and a
`@tanstack/react-query` matching the dashboard's pinned copy; the phase that adds
an extension adds those with it, rather than carrying them unused now.
