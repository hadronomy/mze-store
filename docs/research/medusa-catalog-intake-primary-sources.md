# Medusa catalog intake: primary-source research for issue #134

Date: 2026-08-21

This note covers the first catalog vertical slice in [issue #134](https://github.com/hadronomy/mze-store/issues/134).
It separates facts from recommendations. It uses the pinned Medusa package,
the Medusa source at tag `v2.18.0`, current Medusa `develop`, current Medusa
examples, and the current Mercur extension.

## Source ledger

- The repository pins `@medusajs/medusa`, `@medusajs/framework`, and related
  packages to `2.18.0` in `bun.lock`.
- The installed package paths are
  `node_modules/.bun/@medusajs+medusa@2.18.0+c57dfac52ab3a0c5/node_modules/@medusajs/medusa`
  and
  `node_modules/.bun/@medusajs+framework@2.18.0+4a8052f2ed1c805d/node_modules/@medusajs/framework`.
  The installed packages contain compiled `dist` output. The matching source
  tag is [Medusa `v2.18.0` at `b574ef20cbd58bc6a3361a3da969070e6ca97846`](https://github.com/medusajs/medusa/tree/b574ef20cbd58bc6a3361a3da969070e6ca97846).
- The key pinned workflow source is [`create-products.ts`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/core-flows/src/product/workflows/create-products.ts),
  [`create-product-variants.ts`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/core-flows/src/product/workflows/create-product-variants.ts),
  and [`create-remote-links.ts`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/core-flows/src/common/steps/create-remote-links.ts).
- Current upstream Medusa `develop` is
  [`13a43089f38c12364e14a0cfdb1561ad0c8f29dd`](https://github.com/medusajs/medusa/tree/13a43089f38c12364e14a0cfdb1561ad0c8f29dd).
  Use it for direction only. The installed `2.18.0` source wins for this
  implementation.
- Current [`medusajs/examples`](https://github.com/medusajs/examples/tree/aae76657952903750dfcaaaf28b6746f20ab1af5)
  is at `aae76657952903750dfcaaaf28b6746f20ab1af5`.
  Its [`bundled-products` example](https://github.com/medusajs/examples/tree/aae76657952903750dfcaaaf28b6746f20ab1af5/bundled-products)
  demonstrates a custom DML module, migrations, links, nested Product
  creation, and compensating steps.
- Current [`mercurjs/mercur`](https://github.com/mercurjs/mercur/tree/51f5f6b85b481656d9194e9eedb0abf38fad6d03)
  is at `51f5f6b85b481656d9194e9eedb0abf38fad6d03`. Its current tree uses
  DML modules, `defineLink`, compensating steps, and nested workflows.
- Repository constraints are in [`CONTEXT.md`](../../CONTEXT.md),
  [`docs/architecture.md`](../architecture.md), and
  [`ADR-0030`](../adr/0030-odoo-medusa-sync-uses-a-typed-bridge-and-split-ownership.md).
  The local durable-operation example is the Tax Rate Audit module and its
  [`tax-rate-audit-operations.ts`](../../apps/medusa/src/workflows/tax-rate-audit-operations.ts).

## Facts from the pinned Medusa source

### Custom modules, models, and migrations

- A custom module defines DML models with `model.define`. A service extends
  `MedusaService` with the model map. The module exports `Module(MODULE_ID,
{ service })` and the app registers the module in `medusa-config.ts`.
- A model can declare DML relations such as `hasMany` and `belongsTo`. Medusa
  creates the normal timestamp and soft-delete columns in the generated
  migration.
- A module migration extends Medusa's `Migration` class and emits SQL in
  `up()` and reverse SQL in `down()`. The bundled-products example creates
  `bundle` and `bundle_item`, adds indexes, and adds a foreign key.
- The module loader passes the module declaration options to the module
  service. A module service can expose application-start and
  application-shutdown hooks. This gives one owner for a long-lived gateway
  client and its close operation.
- The framework loads module resources before it registers the module service
  in the container. Routes and workflow steps resolve the service by the
  module key. They do not construct a second service instance.

Primary examples: [`bundle.ts`](https://github.com/medusajs/examples/blob/aae76657952903750dfcaaaf28b6746f20ab1af5/bundled-products/src/modules/bundled-product/models/bundle.ts),
[`bundle-item.ts`](https://github.com/medusajs/examples/blob/aae76657952903750dfcaaaf28b6746f20ab1af5/bundled-products/src/modules/bundled-product/models/bundle-item.ts),
[`service.ts`](https://github.com/medusajs/examples/blob/aae76657952903750dfcaaaf28b6746f20ab1af5/bundled-products/src/modules/bundled-product/service.ts),
and [`Migration20250428093025.ts`](https://github.com/medusajs/examples/blob/aae76657952903750dfcaaaf28b6746f20ab1af5/bundled-products/src/modules/bundled-product/migrations/Migration20250428093025.ts).

### Module links

- `defineLink` consumes the `linkable` exports of two queryable modules. It
  checks that both services and both linkable keys exist, then registers a
  link module for the query graph.
- A link is a separate module record. It is not a foreign key in either
  business module. The link definition can set list behavior, cascade delete,
  aliases, filterable fields, and link-table options.
- `createRemoteLinkStep` resolves the Link service, calls `link.create`, and
  returns the created definitions as its compensation input. Its compensation
  calls `link.dismiss`.
- Link files are discovered and imported from the app link directory. The
  link module must be loaded with both endpoint modules.
- The bundled-products example defines one link from Bundle to Product and one
  list link from Bundle Item to Product. Its workflow creates those links
  through `createRemoteLinkStep`.

Primary sources: [`define-link.ts`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/utils/src/modules-sdk/define-link.ts),
[`bundle-product.ts`](https://github.com/medusajs/examples/blob/aae76657952903750dfcaaaf28b6746f20ab1af5/bundled-products/src/links/bundle-product.ts),
[`bundle-item-product.ts`](https://github.com/medusajs/examples/blob/aae76657952903750dfcaaaf28b6746f20ab1af5/bundled-products/src/links/bundle-item-product.ts),
and [`create-remote-links.ts`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/core-flows/src/common/steps/create-remote-links.ts).

### Nested Product workflows

- `createProductsWorkflow` first validates that each Product has at least one
  option. It removes variants, sales channels, and shipping-profile data from
  the first Product-module create step.
- It creates Products, creates sales-channel and shipping-profile links, then
  calls `createProductVariantsWorkflow.runAsStep` with the new Product IDs.
- It maps the created Variants back onto each Product, emits the Product
  created event, runs the `productsCreated` hook, and returns the Products.
- `createProductVariantsWorkflow` creates Variants, creates default inventory
  items where needed, links inventory, creates price sets, links pricing, and
  runs the `productVariantsCreated` hook.
- The nested workflow preserves the parent transaction context and uses a
  nested step transaction. Parent cancellation invokes nested workflow
  cancellation.
- The Product creation route follows the same contract. It validates the
  request, runs `createProductsWorkflow(req.scope)`, refetches the Product,
  and returns `{ product }`.

Primary sources: [`create-products.ts`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/core-flows/src/product/workflows/create-products.ts),
[`create-product-variants.ts`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/core-flows/src/product/workflows/create-product-variants.ts),
[`create-products-step`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/core-flows/src/product/steps/create-products.ts),
and the [`Admin Product route`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/medusa/src/api/admin/products/route.ts).

### Compensation

- Product, Product Option, and Product Variant create steps return a
  `StepResponse` with the created IDs. Their compensation deletes those IDs.
- The nested Product workflow has its own compensation. If a later step fails,
  the parent workflow cancels the nested workflow.
- Remote links compensate by dismissing the exact link definitions created by
  the invoke phase.
- A read from Odoo has no source-side compensation. A failed read must leave a
  durable local failure record. A downstream local failure must compensate
  Product, Variant, and links without attempting to undo an Odoo read.

### Idempotent operation records

- Medusa workflow execution has transaction and step idempotency keys. These
  keys resume workflow execution. They do not replace a domain record that an
  Operator can inspect after an external failure.
- This repository's Tax Rate Audit module stores `operation_id` and
  `request_fingerprint` in durable tables. It enforces a unique partial index
  on `operation_id`, compares a replay with the original input, and raises a
  conflict when the fingerprint differs.
- The local operation service handles a concurrent unique-index race by
  rereading the row and applying the same equality check. The workflow caller
  takes a distributed lock for the operation ID.
- This pattern gives three outcomes: replay the same operation, report a
  conflict for changed input, or create a new operation.

Primary local sources: [`tax-rate-audit-operation.ts`](../../apps/medusa/src/modules/tax-rate-audit/models/tax-rate-audit-operation.ts),
[`Migration20260811120000.ts`](../../apps/medusa/src/modules/tax-rate-audit/migrations/Migration20260811120000.ts),
[`service.ts`](../../apps/medusa/src/modules/tax-rate-audit/service.ts),
and [`tax-rate-audit-operations.ts`](../../apps/medusa/src/workflows/tax-rate-audit-operations.ts).

### Admin route shape

- Custom Admin routes live below `src/api/admin/**/route.ts`.
- A route uses `AuthenticatedMedusaRequest`, a validated body, and
  `MedusaResponse`. It resolves no business service directly for a mutation.
- The route invokes a workflow with `workflow(req.scope).run({ input })`.
  It refetches through the query layer when the response needs linked or
  selected fields.
- The route returns a stable JSON envelope. The pinned Product route returns
  `{ product }`; the bundled-products example returns `{ bundled_product }`.
- The local Tax Rate Audit route uses `Idempotency-Key` or
  `X-Idempotency-Key`, validates its length, and turns malformed keys into a
  visible 400 failure.

## Recommendations for issue #134

### Intake workflow boundary

Use one Admin-only workflow for one bounded Catalog Batch item. Keep the
sequence below in the workflow:

1. Decode the request and compute a canonical request fingerprint.
2. Create or replay the durable Sync Record before the Odoo call.
3. If the record is already complete with the same fingerprint, return its
   stored Product, Variant, and Catalog Mapping IDs.
4. Call the typed Odoo gateway through one workflow step.
5. Reject a missing Integration Key, duplicate key, malformed payload, or
   source conflict before any Storefront Product create step.
6. Run `createProductsWorkflow` with one Product, one Variant, and one
   source-generated option: `Configuration = Default`.
7. Create the Catalog Mapping and link records in the same local workflow.
8. Mark the Sync Record complete with the Product and Variant IDs.

If a local step fails after the Odoo read, let Medusa compensate Product,
Variant, option, and link creation. Keep the Sync Record in a durable failed
state. Do not compensate the failure record away.

### Product input

Pass the generated option and its value in the same Product input. Pass the
Variant option map with `Configuration: "Default"`. The pinned workflow
requires an option even when the source has no shopper-facing option.

The core Product Option model does not expose a general `hidden` property. The
pinned `CreateProductOptionDTO` accepts option metadata, but the Medusa 2.18
nested Product workflow did not persist that metadata in an integration test.
Create the exclusive option with the Product, then call
`updateProductOptionsWorkflow.runAsStep` in the same compensating workflow to
mark it as hidden and source-generated. Make the Storefront omit options with
that marker. Do not invent a core `hidden` field or put Odoo identity in
Product metadata.

### Catalog Mapping and Sync Record

Use a custom catalog module with DML models and one migration. Store the Odoo
Integration Key, Odoo model and database ID, Source Revision, fingerprint,
Medusa Product ID, Medusa Variant ID, and current sync state on the Catalog
Mapping. Put `operation_id`, fingerprint, state, safe failure details, and the
result IDs on the Sync Record.

Add database uniqueness for the Integration Key and operation ID. Keep the
fingerprint comparison in the service. Handle the unique-index race by
rereading the existing row, as the local Tax Rate Audit module does.

Define the two module links required by the parent design: Product to template
Catalog Mapping, and Product Variant to Variant Catalog Mapping. The Mapping's
stable Integration Key remains a local unique field. A link is not a
substitute for that identity or for the durable replay record.

### Odoo gateway ownership and lifecycle

Resolve the typed Odoo bridge from one Medusa module service. Pass its private
route and credential options through the module declaration. Let that service
own one gateway client and its shutdown hook. Do not construct a client in a
route, Product request, Cart request, or each workflow step.

The gateway step performs a read only. Its failure is an expected Sync Record
failure, not a Product compensation reason. The Storefront never resolves the
gateway and never calls Odoo during Product or Cart requests.

### External-seam testing

Expose the gateway replacement through the normal module options or service
context. Do not add a test-only constructor. Test through the workflow and
Admin route seams.

Cover these cases:

- one valid payload creates exactly one Product, Variant, option, Mapping, and
  completed Sync Record;
- replay with the same operation ID and fingerprint returns the same IDs;
- the same operation ID with a different fingerprint returns conflict;
- a missing or duplicate Integration Key, malformed payload, source conflict,
  timeout, and rejected gateway response leave no partial Product;
- a downstream Product, Variant, or link failure compensates local records;
- the Sync Record remains visible as failed and replays the same failure;
- gateway close runs once during application shutdown;
- concurrent requests with one operation ID produce one durable record.

Use Medusa integration tests for the Admin route and database state. Use a
fake gateway for deterministic workflow tests. Keep the Odoo bridge contract
test separate from Product workflow tests. The local
`medusaIntegrationTestRunner` and Tax Rate Audit tests provide the closest
repository pattern for authenticated Admin calls, replay, conflict, and
visible failure assertions.

### Ownership summary

```
Admin route
  -> intake workflow
       -> Sync Record module (durable replay and failure state)
       -> Odoo gateway step (read only)
       -> createProductsWorkflow
            -> Product + Configuration option
            -> nested createProductVariantsWorkflow
       -> updateProductOptionsWorkflow
       -> Catalog Mapping module and two required module links
```

This shape keeps route logic thin, keeps Odoo outside Storefront requests,
and gives each failure a durable owner.
