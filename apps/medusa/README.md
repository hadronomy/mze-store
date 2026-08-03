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
bun run seed
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

## The seed

`bun run seed` creates the Spanish territory model in the database:

- One Region for Spain.
- Tax Regions for peninsular VAT and for Canarian IGIC.
- Two Service Zones, each one scoped to Provinces.
- A probe Product with one Variant that carries a price.

[ADR-0005](../../docs/adr/0005-canarias-is-a-province-not-a-region.md) gives the
reason for this shape. `src/territory/spain.ts` holds the rates and the Province
lists. It is the only place that writes a rate.

**CAUTION: Before a gestor approves the rates, do not show a Shopper a price
that comes from them.** EU law puts tax in the displayed price. A wrong rate is
therefore a wrong price for the Shopper. You cannot correct it in the accounts
later.

You can run the seed as many times as you want. It finds each piece by something
stable before it creates that piece. A second run therefore creates nothing, and
a run against a half-seeded database fills the gaps.

The seed creates, but it does not correct. It keeps a Region or a rate that you
edited in the admin. To put the model back, edit it in the admin.

To see the result that the seed exists to prove, start the backend. Then run
this command:

```sh
curl "http://localhost:9000/store/products?handle=tax-model-probe&country_code=es&province=es-tf&fields=*variants.calculated_price" \
  -H "x-publishable-api-key: <the key that the seed prints>"
```

`calculated_amount_with_tax` returns 107 for a stored price of 100. Change
`es-tf` to `es-m`, and it returns 121. The Variant, the Region, and the stored
price are the same in both requests.

An Operator sees the same model in the admin:

- **Settings → Tax Regions** shows the rates.
- **Settings → Locations & Shipping** shows the two Service Zones.
- The price of a Variant is the number that both Provinces compute from.

## Tests

```sh
bun run test
```

Jest, because Medusa's test utilities are jest-based and this app is a CJS
island (ADR-0012). It is the only suite in the workspace so far; the storefront
is expected to bring vitest, and the two are not to be unified.

`integration-tests/http/` is the seam every later phase extends:
`medusaIntegrationTestRunner` boots the real app against a real database, so a
passing suite is proof that the backend builds, migrates, and serves. It needs
Postgres and Redis up, and it creates and drops a database per jest worker.

The suite flushes its Redis database before booting, so it refuses to run
against index 0 — see `.env.test`.

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
