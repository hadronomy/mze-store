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
bun run seed:probe                     # development only, see below
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

It creates nothing that a Shopper sees, so it is safe against any database. A
deployment does not need it: `db:migrate` creates the same model through a
migration script. Use this command against a database you are working on.

`bun run seed:probe` adds a Product, a Variant with a price, and a publishable
API key. Together they read a price back from the Store API.

**CAUTION: Do not run `bun run seed:probe` against a live store.** The Product
is published and it is in the Sales Channel, so a Shopper sees it and can buy
it. Use it on a development or a test database. The two commands are separate
for this reason: one carries the tax model, which is policy, and the other
carries a fixture.

[ADR-0005](../../docs/adr/0005-canarias-is-a-province-not-a-region.md) gives the
reason for this shape. `src/territory/spain.ts` holds the rates and the Province
lists that a new database starts from.

**The database is authoritative, not the code.** See
[ADR-0019](../../docs/adr/0019-the-database-owns-the-territory-model.md). After
the first seed, an Operator owns the model in the admin. **Settings → Tax
Regions** edits a rate, adds a Province, or adds an override. Nothing reads
`spain.ts` at run time. A
rate changes by law on a date that a release cannot predict, so an Operator
changes it in a form and not through a deploy. The seed never writes over that
edit.

**CAUTION: Before a Shopper sees a price, a gestor must approve the rate that
the admin shows.** EU law puts tax in the displayed price. A wrong rate is
therefore a wrong price for the Shopper. You cannot correct it in the accounts
later.

You can run either command as many times as you want. Each one finds a piece by
something stable before it creates that piece. A second run therefore creates
nothing, and a run against a database that has some of the model creates the
rest.

The seed creates, but it does not correct. It keeps a Region, a rate, or a
Service Zone that you edited in the admin. To put the model back, edit it in the
admin.

This matters because a deployment runs the model too, through
`src/migration-scripts/001-spanish-territory.ts`. A seed that put back what an
Operator removed would undo that Operator. It cannot tell a Province you took
out from one it never added, so it leaves an existing Service Zone alone.

## A deployment creates the model for itself

`medusa db:migrate` runs the files in `src/migration-scripts/` after it migrates
the schema, so `docker compose up` needs no seed step. Medusa records each file
by name in `script_migrations` and never runs it again. A script that throws is
not recorded, and the next `db:migrate` runs it again.

Two things follow. A deployment starts no second application to write nothing,
because the scripts run in the process that is already migrating. A release
after the first cannot fail on the seed, because there is nothing left to run.

A later change to the model is a new file beside the first, and not an edit to
it. The file name is the record, so a rename runs the script again against every
database that already has it.

To see the result that the model exists to prove, run both seeds. Then start the
backend and run this command:

```sh
curl "http://localhost:9000/store/products?handle=tax-model-probe&country_code=es&province=es-tf&fields=*variants.calculated_price" \
  -H "x-publishable-api-key: <the key that seed:probe prints>"
```

On a database that only the seeds have touched, `calculated_amount_with_tax`
returns 107 for a stored price of 100. Change `es-tf` to `es-m`, and it
returns 121. The Variant, the Region, and the stored price are the same in
both requests. A store whose rates an Operator has since edited returns the
rates that the admin shows.

An Operator owns the model in the admin, and needs no release to change it:

- **Settings → Tax Regions** edits a rate, adds a Province such as `es-ce`, and
  adds an override for a Product.
- **Settings → Locations & Shipping** edits the two Service Zones and the
  Provinces in each one.
- **Settings → Regions** edits the currency and the payment providers.
- The price of a Variant is the number that both Provinces compute from.

## Tests

```sh
bun run test
```

The suite uses jest, because Medusa's test utilities are jest-based and this app
is a CJS island (ADR-0012). It is the only suite in the workspace today. The
storefront brings vitest later, and the two do not merge.

`integration-tests/http/` is the seam that every later phase extends.
`medusaIntegrationTestRunner` boots the real app against a real database. A
passing suite is therefore proof that the backend builds, migrates, and serves.
It needs Postgres and Redis, and it creates and drops one database for each jest
worker.

Each jest worker also gets a Redis database of its own, and
`integration-tests/setup.js` numbers them from 1. The suite flushes that database
before the backend starts. Database 0 holds the state of `medusa develop`, and no
worker can reach it. See `.env.test`.

The runner disables the admin dashboard, so a test cannot reach `/app`. You
verify that one when you run the backend.

`ioredis` is pinned to the exact version that Medusa resolves, for the same
reason that ADR-0001 forbids a direct `@mikro-orm/*`: the test client and the
modules under test must use one copy of the driver, and not two.

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
