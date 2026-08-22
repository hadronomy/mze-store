# Architecture

Vocabulary in [`CONTEXT.md`](../CONTEXT.md). Decisions and their reasoning in [`docs/adr/`](./adr/) — this document describes the shape, not why it was chosen.

## Layout

```
mze-store/
├── mise.toml                  tool versions (node, bun)
├── vite.config.ts             Vite+ workspace config
├── apps/
│   ├── medusa/                Medusa backend + admin   CJS, module: Node16
│   └── storefront/            TanStack Start           ESM, moduleResolution: Bundler
├── packages/
│   ├── medusa-sdk/            server half (holds token) + client half (calls server fns)
│   ├── auth/                  better-auth — source of record for Accounts
│   ├── db/                    Drizzle — better-auth tables only, `auth` schema
│   ├── design-tokens/         pure-TS design tokens; CSS generated from them
│   ├── territory/             Province identity data and input schemas
│   ├── odoo-bridge/            typed private Odoo JSON-2 client and contract
│   ├── ui/                    shadcn primitives
│   ├── env/                   validated environment
│   └── config/                shared tsconfig base
└── tooling/
    └── oxlint/                private Effect-based Oxlint plugin package
```

**The two apps cannot share a tsconfig.** Medusa needs CJS, `Node16` resolution, and decorators; the storefront needs ESM and `Bundler`. `packages/config` carries only the strictness flags they agree on; each app overrides module resolution. Unifying these is the most likely way to break the workspace — and it has been tested, not assumed. See ADR-0012.

**Only pure-TypeScript packages may be imported by both apps.** Anything the backend imports must emit CJS. Anything with runtime code or JSX picks a side. See ADR-0011 and ADR-0012.

## Build toolchain

Three surfaces use Vite+ / rolldown. Medusa admin and backend use separate toolchains.

| Surface                   | Tool                               | Output                                  |
| ------------------------- | ---------------------------------- | --------------------------------------- |
| Storefront                | Vite+ / rolldown                   | bundled ESM                             |
| `packages/*`              | Vite+ / rolldown                   | ESM, plus CJS if the backend imports it |
| Oxlint plugin             | Vite+ / rolldown                   | ESM plugin with declarations            |
| Medusa admin + extensions | `@medusajs/admin-bundler` (Vite 5) | bundled                                 |
| Medusa backend            | TypeScript compiler API            | **unbundled, file-per-file CJS**        |

The backend is neither bundled nor bundle-able: Medusa discovers routes, subscribers, jobs, workflows, and modules by walking the file tree at runtime. ADR-0012 has the reasoning and the failed ESM experiment.

Admin extensions — widgets and custom pages under `apps/medusa/src/admin/` — ride Medusa's Vite 5 bundler, tunable through `admin.vite()` in `medusa-config`. They are a genuine product surface, not just configuration, and no scope decision has been taken on them yet.

## Request paths

Two paths, distinguished by one question: does this request carry credentials?

```
Public catalog read
  browser ──────────────────────────────────► Medusa /store/*
                                              (publishable key, cacheable)

Anything credentialed
  browser ──► storefront server ────────────► Medusa /store/*
              │                                (Bearer, minted server-side)
              └─ better-auth session (HttpOnly)
```

The Medusa token never reaches the browser. The storefront server mints it from the better-auth session, caches it in-process for ~15 minutes keyed by session token, and evicts on sign-out. See ADR-0004.

## Identity

The Account **proves**; commerce alone **signs**. No shared signing key, ever — ADR-0013 explains why the tempting alternative is rejected.

```
better-auth                     POST /store/auth/session   (one call, atomic)
 Account                    ──►  ├─ verify better-auth JWT over JWKS
 email verification              ├─ Provisioning: resolve or create the Customer
 sessions                        ├─ bind app_metadata → actor_id
                                 └─ mint Medusa token  ──►  usable immediately
```

Medusa's two-phase identity model — authenticated but unable to act — stays behind that route. The storefront never sees it. See ADR-0014.

**Field ownership** splits at identity versus profile: email projects down from the Account on every exchange; name, phone, and addresses belong to the Customer and are never overwritten. See ADR-0003.

**Claims** fire on better-auth's `afterEmailVerification`, not as a post-purchase prompt — that is the instant a Claim becomes permissible.

Operators are not bridged — admin sign-in stays on Medusa's native `emailpass`.

A Shopper can complete a purchase with no Account at all. Nothing in the buying path may assume an authenticated Shopper. See ADR-0008.

## Territory resolution

Region, Tax Region, and Service Zone vary independently. Resolution order on first request:

1. **Country** from the URL prefix (`/es/`, `/fr/`) → selects the Region → currency and payment methods.
2. **Province** from geo-IP, defaulting to Canarias → selects the Tax Region → the tax-inclusive price shown, and the Service Zone → available shipping.
3. Both are held in cookies and surfaced as visible controls.

Province must be resolved _before first paint_, because displayed prices include tax and IGIC differs from VAT. See ADR-0005.

## Stock

```
Odoo (true stock)  ──publishes──►  Online Allocation  ◄──reserves──  Cart
   till, purchasing, returns          per Variant                     under lock
```

Medusa reserves against the Online Allocation only, never shop-floor stock. Reservations require the distributed lock provider to be correct. See ADR-0009.

## Orders, invoicing, and the ERP

Odoo is the ERP for fulfilment, accounting, and invoice **issuance**. Medusa owns everything the Shopper touches.

```
checkout ──► Order ──payment capture──► Sync Record ──► Odoo
 (never                                  durable,        issues Invoice
  touches                                retryable,      (series, hash chain,
  Odoo)                                  visible          AEAT / Veri*Factu)
                                                              │
   Shopper ◄── PDF ◄── Takumi render ◄── invoice payload ◄────┘
              (per request, never stored)
```

The renderer reads the same design tokens as the Storefront, so the document a Shopper keeps and the shop they bought it in cannot drift apart. See ADR-0023.

Three rules hold this together:

1. **Checkout never touches Odoo.** A sale must not depend on ERP uptime. What the Shopper gets at checkout is an Order Confirmation, which is not a fiscal document.
2. **Odoo owns every number; Medusa owns only pixels.** The renderer's sole input is Odoo's invoice payload — it has no access to Medusa's Order data, structurally, so it cannot drift from what was declared to AEAT.
3. **Nothing rendered is ever stored.** Corrections propagate with no invalidation logic, and the erasure purge has no rendered artifacts to chase.

See ADR-0017 for the issue/deliver split, ADR-0023 for the renderer, and ADR-0018 for why rendering works this way.

Veri\*Factu becomes mandatory in 2027 (January for corporations, July otherwise). Compliance is a vendor dependency on Odoo's `l10n_es_edi_verifactu`, not something this codebase implements.

## Catalog bridge

The first Odoo link is a read-only gate. Medusa reaches Odoo only through the private route and the typed `@mze-store/odoo-bridge` Result edge:

```
Odoo Product and Variant
  └─ mze_medusa_bridge/read_catalog_batch
       └─ private JSON-2 ──► OdooBridge Result client ──► normalized Catalog Batch
```

The Odoo addon owns the Integration Keys and the normalized source shape. Medusa reads the Bridge Contract but does not write Odoo records. The service API key comes from OpenBao and belongs to a dedicated read-only Service User. The public customer hostname is not an allowed `ODOO_BASE_URL`.

The root client returns Effect `Result` values for configuration, remote,
cancellation, and closure failures. Unknown defects reject the Promise. The
`/effect` entry exposes the same operations with exact Effect error channels.

The authenticated Admin intake route imports one Catalog Item at a time. It
creates and updates a durable Sync Record outside compensation. It then runs
the Product, Variant, option, Mapping, and link writes in one compensating
Medusa workflow:

```
POST /admin/odoo/catalog-imports
  └─ durable Sync Record
       └─ Odoo Catalog Batch read (limit 1)
            └─ draft Product + complete Odoo Variant set + structural options
                 └─ normalized source mappings + Product module links
```

Odoo Integration Keys and database IDs identify Product templates and
Variants. Odoo attribute, value, and template-value IDs identify the Variant
structure. Names, barcodes, internal references, and labels never identify a
mapping. `always` attributes become visible Product Options. `dynamic`
attributes become hidden structural Product Options. `never` attributes stay
in Catalog sidecars. A Product without a projected attribute keeps the hidden
`Configuration = Default` option. Source-generated Product Options are
exclusive to each Product, so common source labels do not create global title
conflicts.

Resync updates source-owned SKU, barcode, price, labels, revision, and
availability snapshots. It keeps Medusa-owned presentation and all stable
Medusa IDs. An archived or unsaleable Variant remains mapped for Order history.
Imported Products remain Medusa drafts. The authoring and Storefront
availability projection belongs to the next Catalog layer in issue #136.

The operation ID and request fingerprint control replay. A completed operation
returns its existing IDs without another Odoo call. A failed operation returns
the same stored failure; the Operator uses a new operation ID after source
repair. The Store Product and Cart paths read Medusa data only and never
resolve the Odoo bridge.

The rollout gate checks the machine documentation, the documented bridge method, and one catalog item in that order. If any check fails, it exits with an `ODOO_ROLLOUT_BLOCKER` and no write path is available. See [`docs/runbooks/odoo-json2-gate.md`](./runbooks/odoo-json2-gate.md) and ADR-0030.

## Layer discipline

Medusa's rule, and it is not optional:

```
Module (data + CRUD)  →  Workflow (business logic, compensation)  →  API route (HTTP)  →  Storefront
```

Mutations go through workflows. Routes validate and delegate. Business logic in a route is a defect, not a shortcut. Custom endpoints belong under `apps/medusa/src/api/admin/*` or `apps/medusa/src/api/store/*` — there is no parallel API layer. See ADR-0002.
