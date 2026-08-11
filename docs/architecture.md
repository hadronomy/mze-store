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
└── packages/
    ├── medusa-sdk/            server half (holds token) + client half (calls server fns)
    ├── auth/                  better-auth — source of record for Accounts
    ├── db/                    Drizzle — better-auth tables only, `auth` schema
    ├── email-tokens/          pure-TS design tokens, shared across both apps
    ├── territory/             Province identity data and input schemas
    ├── ui/                    shadcn primitives
    ├── env/                   validated environment
    └── config/                shared tsconfig base
```

**The two apps cannot share a tsconfig.** Medusa needs CJS, `Node16` resolution, and decorators; the storefront needs ESM and `Bundler`. `packages/config` carries only the strictness flags they agree on; each app overrides module resolution. Unifying these is the most likely way to break the workspace — and it has been tested, not assumed. See ADR-0012.

**Only pure-TypeScript packages may be imported by both apps.** Anything the backend imports must emit CJS. Anything with runtime code or JSX picks a side. See ADR-0011 and ADR-0012.

## Build toolchain

Three of four surfaces are Vite+ / rolldown. The backend is the exception, deliberately.

| Surface                   | Tool                               | Output                                  |
| ------------------------- | ---------------------------------- | --------------------------------------- |
| Storefront                | Vite+ / rolldown                   | bundled ESM                             |
| `packages/*`              | Vite+ / rolldown                   | ESM, plus CJS if the backend imports it |
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
   Shopper ◄── PDF ◄── Typst render ◄── invoice payload ◄─────┘
              (per request, never stored)
```

Three rules hold this together:

1. **Checkout never touches Odoo.** A sale must not depend on ERP uptime. What the Shopper gets at checkout is an Order Confirmation, which is not a fiscal document.
2. **Odoo owns every number; Medusa owns only pixels.** The renderer's sole input is Odoo's invoice payload — it has no access to Medusa's Order data, structurally, so it cannot drift from what was declared to AEAT.
3. **Nothing rendered is ever stored.** Corrections propagate with no invalidation logic, and the erasure purge has no rendered artifacts to chase.

See ADR-0017 for the issue/deliver split and ADR-0018 for rendering.

Veri\*Factu becomes mandatory in 2027 (January for corporations, July otherwise). Compliance is a vendor dependency on Odoo's `l10n_es_edi_verifactu`, not something this codebase implements.

## Layer discipline

Medusa's rule, and it is not optional:

```
Module (data + CRUD)  →  Workflow (business logic, compensation)  →  API route (HTTP)  →  Storefront
```

Mutations go through workflows. Routes validate and delegate. Business logic in a route is a defect, not a shortcut. Custom endpoints belong in `apps/medusa/src/api/store/*` — there is no parallel API layer. See ADR-0002.
