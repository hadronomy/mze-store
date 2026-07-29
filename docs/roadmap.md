# Roadmap

Estimates assume no unfamiliar blockers. Phases 1–4 take money without phase 5.

## 1 — Foundation · ~1h

- `mise.toml` pinning node 24 and bun 1.3.14 to match `packageManager`
- Catalog bumped: Medusa 2.18, TanStack 1.168, vite-plus 0.2.6
- tsconfig split — `packages/config` keeps only shared strictness
- Delete `packages/api`; rename `apps/web` → `apps/storefront` and strip the template scaffolding
- Vite+ task wiring, `dependsOn` for build ordering

Nothing Medusa-specific. Fully reversible.

## 2 — Medusa backend · ~3h

- `apps/medusa` builds, migrates, and serves; admin reachable at `/app`
- Redis registered for caching, event bus, workflow engine, and locking
- better-auth's Drizzle tables relocated to the `auth` schema
- Regions, Tax Regions (peninsula VAT, Canarias IGIC), and Service Zones seeded
- Stripe payment provider registered

Exit criterion: an Operator can sign in, create a Variant, and see correct tax for both a peninsular and a Canarian address.

## Design gate

**Blocks phase 3.** Product, signature artifact, type voice, and palette decided before the first storefront component exists — once component structure exists it acquires inertia, and design applied afterward becomes a reskin.

Still outstanding: the actual product. Not the category — the noun. It drives the signature artifact and the catalog seed, and placeholder products are themselves a tell.

## 3 — Storefront core · ~2d

- `packages/medusa-sdk` split into server and client halves, query-options factories over loose hooks
- Country prefix routing; Province resolution via geo-IP with a visible control
- Catalog, faceted filtering, sort, native `q` search
- Cart

Largest phase, and the one the large-catalog decision inflated.

## 4 — Checkout · ~1d

- Stripe `PaymentElement` with `automaticPaymentMethods`
- Guest checkout end-to-end
- Webhook at `/hooks/payment/stripe_stripe`, including async methods
- Resend wired; order confirmation email

Exit criterion: a real card, in test mode, produces an Order and a confirmation email.

## 5 — Account bridge · ~2d

- Custom Medusa auth provider verifying better-auth JWTs over JWKS (ADR-0013)
- `POST /store/auth/session` — one atomic route: verify, provision, bind, mint (ADR-0014)
- Provisioning workflow with resolve and create branches, idempotent, compensating
- Token TTL and in-process cache with eviction on sign-out
- Email verification enforced; Claim subscriber on `afterEmailVerification`
- Email projection down to the Customer; profile fields left alone

Not on the critical path to revenue — guest checkout already sells.

## 5b — Account admin extension · ~1d

Decided in principle, sized roughly. Medusa admin cannot see or manage Accounts at all, so Operators would context-switch to a second tool for routine support.

- Account panel on the Customer page: email, verification state, sessions
- Email edits write through to better-auth and force re-verification (ADR-0008)
- Reveals the projection as a single editable field, so Operators never see the seam

## 6 — Erasure · ~1d · required at launch

Not deferrable. Guest checkout means personal data exists from the first Order, so this must ship before real Shoppers do.

- Small custom module: `ErasureRequest` model
- Erasure workflow — scrub Customer to a tombstone, delete Account, record completion; idempotent and compensating
- Scheduled job: retry incomplete requests, purge Order PII past the Retention Window
- Confirm the retention period with an accountant before the purge job goes live

Do **not** wire the stock `removeCustomerAccountWorkflow` — it soft-deletes and erases nothing. See ADR-0015.

## 7 — ERP link and invoicing · ~3d · required at launch

Moved out of "Later". Odoo is now on the launch path: you cannot sell without invoicing, and Odoo issues (ADR-0017).

- `SyncRecord` model, workflow, and admin queue — push Order to Odoo on payment capture, durable and retryable, failures visible
- Odoo web numbering series, kept gapless independently of shop and POS
- Invoice payload endpoint: Medusa reads Odoo's issued figures
- Typst templates and a render-per-request endpoint (ADR-0018); the renderer sees the payload only, never an Order
- Delivery: invoice email, account-area view, re-download

Degradable before this ships — Operators issue manually in Odoo and nothing delivers automatically. Fine at low volume, not for long.

**Veri*Factu is a requirement, not a deadline.** Enabled in Odoo before the first web Invoice, so the web series is chained from #1 rather than acquiring a seam mid-stream. The statutory dates (Jan/Jul 2027) are the outside limit, not the target.

Compliance rides on Odoo core: `l10n_es_edi_verifactu` and `l10n_es_edi_verifactu_pos`, both shipping in Community 19 and already installed. Configuration — certificate, series, submission mode — is the remaining work, and belongs before the first web Invoice rather than "when needed".

## Later

**Inventory sync.** Odoo publishes the Online Allocation (ADR-0009). Phase 7 builds the Order push; the stock pull is the other half and can follow.

**Admin extensions.** Partly decided — phase 5b covers the Account panel. Still undecided: Online Allocation against true stock per Variant, sync-queue triage beyond the basic view in phase 7, manual re-sync. Widget and custom-page work on Medusa's Vite 5 bundler (ADR-0012).

**Revisit against evidence, not schedule:**

- A search service, if result quality or facet speed on the real catalog proves inadequate (ADR-0010)
- Ceuta and Melilla (IPSI), if shipping there
- Subscriptions, which would make better-auth's Stripe plugin worth its collision cost
