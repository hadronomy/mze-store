# Medusa multi-Variant catalog: primary-source research for issue #135

Date: 2026-08-21

This note supports [issue #135](https://github.com/hadronomy/mze-store/issues/135).
It also uses the parent decisions in [issue #131](https://github.com/hadronomy/mze-store/issues/131).
It separates verified facts from recommendations.

The project terms come from [`CONTEXT.md`](../../CONTEXT.md). The boundary
rules come from [`docs/architecture.md`](../architecture.md),
[`api-design.md`](../agents/api-design.md),
[`effect-api-design.md`](../agents/effect-api-design.md), and
[`ADR-0030`](../adr/0030-odoo-medusa-sync-uses-a-typed-bridge-and-split-ownership.md).
The current #134 implementation is at commit
[`3c290705`](https://github.com/hadronomy/mze-store/commit/3c290705bbd683d23df87d24ce57a6abbf4c0b68).

## Source lock

- The installed Medusa packages are `2.18.0`. The important local compiled
  paths are `node_modules/.bun/@medusajs+core-flows@2.18.0+eff93d1321803b0c`,
  `node_modules/.bun/@medusajs+product@2.18.0+eff93d1321803b0c`, and
  `node_modules/.bun/@medusajs+types@2.18.0+3f54c1b165eee1a7`.
- The installed `@medusajs/medusa` package reports git head
  `cd1f5afa5aa8c0b15ea957008ee19f1d695cbd2e`, but that commit is not present
  in the public Medusa repository. I use the published `v2.18.0` source tag,
  root commit [`b574ef20`](https://github.com/medusajs/medusa/tree/b574ef20cbd58bc6a3361a3da969070e6ca97846),
  for exact source links.
- Current Medusa `develop` was
  [`b2eaae16`](https://github.com/medusajs/medusa/tree/b2eaae16e512c0a82390dad6d072330852b2e3c4)
  when this note was written. It still has no Variant status field. The
  `v2.18.0` source and installed declarations remain the implementation source.
- The current serious Medusa extension [Mercur](https://github.com/mercurjs/mercur/tree/d2c8a5abbd0610de3ad20eac449877e342449d69)
  is pinned at commit `d2c8a5ab`. Its root and API packages pin Medusa
  `2.18.0`. Its Product Attribute module gives a useful source-attribute and
  native-option mirror pattern.
- The first-party [Medusa product-builder example](https://github.com/medusajs/examples/tree/aae76657952903750dfcaaaf28b6746f20ab1af5/product-builder)
  is pinned at `aae76657952903750dfcaaaf28b6746f20ab1af5`. It demonstrates a
  custom DML module, module links, workflow steps, and compensation. Its
  package currently pins `2.14.0`, so it gives extension direction only.

## Facts from Medusa 2.18.0

### Product creation accepts many Variants, but it needs an Option

`createProductsWorkflow` validates that every Product has at least one Option.
It removes Variant, sales-channel, and shipping-profile data from the first
Product-module write. It then calls
`createProductVariantsWorkflow.runAsStep` with all Variant inputs.

Sources: [`create-products.ts#L73-L101`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/core-flows/src/product/workflows/create-products.ts#L73-L101), [`create-products.ts#L163-L247`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/core-flows/src/product/workflows/create-products.ts#L163-L247), and the installed `dist/product/workflows/create-products.js`.

The workflow returns Products with Variants grouped by `product_id`. The
Variant-to-input mapping relies on the order of the created Variant array.
The source builds the input in order, then groups the returned records. A
Catalog workflow must keep a deterministic source order and preserve the
same positional map until it records each Odoo Integration Key.

### Variant creation writes more than a Variant row

`createProductVariantsWorkflow` accepts an array of Variant inputs. Each input
can contain `options`, `prices`, and inventory-item links. The workflow:

1. creates the Product Variants without prices;
2. creates default Inventory Items when `manage_inventory` is true and no item
   is supplied;
3. creates Product-to-Inventory links;
4. creates Price Sets;
5. links each Price Set to its Variant; and
6. emits the Variant event and runs its hook.

The workflow explicitly relies on input and output order for Price Sets and
Variant-to-Price Set links. This is stated in
[`create-product-variants.ts#L249-L340`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/core-flows/src/product/workflows/create-product-variants.ts#L249-L340).

The native create steps return compensation IDs. Product creation deletes the
created Product IDs. Variant creation deletes the created Variant IDs. Price
Set creation deletes the created Price Set IDs. Remote link creation dismisses
the exact link definitions it created.

Sources: [`create-products.ts`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/core-flows/src/product/steps/create-products.ts), [`create-product-variants.ts`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/core-flows/src/product/steps/create-product-variants.ts), [`create-price-sets.ts`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/core-flows/src/pricing/steps/create-price-sets.ts), and [`create-remote-links.ts`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/core-flows/src/common/steps/create-remote-links.ts).

### Batch Variant management is parallel

`batchProductVariantsWorkflow` runs create, update, and delete workflows in
parallel. It is an Admin convenience workflow. It does not express the
ordered steps needed by a Catalog resync, such as adding Option Values,
creating Variants, writing mappings, projecting availability, and completing a
Sync Record.

Source: [`batch-product-variants.ts#L73-L106`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/core-flows/src/product/workflows/batch-product-variants.ts#L73-L106).

Use the create and update workflows as separate steps in the Catalog workflow.
Do not use the batch workflow as the Catalog transaction coordinator.

### Update Variant semantics depend on whether `options` is present

`updateProductVariantsWorkflow` removes `prices` from the Product-module input,
updates the Variant, then updates linked Price Sets when prices are present.
It captures previous Variant data and compensates with `upsertProductVariants`
when a later hook fails.

When no Variant input contains `options`, the Product Module skips option
resolution, uniqueness scanning, and relation reconciliation. This path is
important for barcode, SKU, title, and price updates. The installed Product
Module integration test proves that a scalar-only update preserves existing
Option Value relations.

When `options` is present, the module loads every Variant for the affected
Product and checks option-tuple uniqueness. It resolves option names and value
labels to native Option Value IDs. The scan is proportional to the Product's
total Variant count.

Sources: [`update-product-variants.ts#L130-L245`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/core-flows/src/product/workflows/update-product-variants.ts#L130-L245), [`update-product-variants.ts#L630-L705`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/modules/product/src/services/product-module-service.ts#L630-L705), and [`product-variants.spec.ts#L432-L470`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/modules/product/integration-tests/__tests__/product-module-service/product-variants.spec.ts#L432-L470).

### Native Variant identity is a Medusa ID

The Product Variant model has a generated `variant` ID. It has `title`, `sku`,
`barcode`, `ean`, `upc`, inventory fields, metadata, and a many-to-many
relation to Product Option Values. It has no `status`, `active`, or
`available` field.

The model has partial unique indexes for `sku`, `barcode`, `ean`, and `upc`.
The indexes ignore soft-deleted rows. A conflicting barcode or internal
reference is a visible source conflict. It is not an identity match.

Source: [`product-variant.ts#L5-L84`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/modules/product/src/models/product-variant.ts#L5-L84).

### Product Option and Option Value IDs are separate from labels

`ProductOption` has a generated `opt` ID, a display `title`, metadata, and
Option Value relations. `ProductOptionValue` has a generated `optval` ID, a
display `value`, a rank, metadata, and relations to Variants and
Product-specific Option Value pivots.

The Product Option Value unique index is `(option_id, value)` for live rows.
The label is not a stable identity. A label change can keep the same native ID
when the integration updates the existing row.

Sources: [`product-option.ts#L8-L48`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/modules/product/src/models/product-option.ts#L8-L48) and [`product-option-value.ts#L7-L39`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/modules/product/src/models/product-option-value.ts#L7-L39).

The Product Module resolves a Variant's `options` object by Option title and
Option Value label. It then stores the resolved `optval` IDs. It checks that
the number of supplied Option Values equals the number of Product Options when
the Variant includes options. It also rejects duplicate combinations.

Sources: [`product-module-service.ts#L3403-L3466`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/modules/product/src/services/product-module-service.ts#L3403-L3466) and [`product-module-service.ts#L3475-L3512`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/modules/product/src/services/product-module-service.ts#L3475-L3512).

Native workflow input does not accept Odoo attribute IDs as Variant identity.
The integration must resolve Odoo IDs to stored Medusa Option and Option Value
IDs before it calls native Variant workflows.

### Option updates can remove only unused values

The Product Module rejects removal of an Option Value that a Product Variant
uses. The workflow integration test checks this exact error. It allows removal
of a value that is not associated with a Product.

Sources: [`update-product-options.spec.ts#L49-L86`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/integration-tests/modules/__tests__/product/workflows/update-product-options.spec.ts#L49-L86) and [`product-module-service.ts#L3800-L3935`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/modules/product/src/services/product-module-service.ts#L3800-L3935).

The public Product Module service exposes `updateProductOptionValues(id,
{ value })`. It can update one native Option Value by ID. The internal option
normalizer also preserves IDs when it receives `{ id, value }` objects, but
that object form is not part of the public `UpdateProductOptionDTO` type.
Use the public ID-based value operation or a typed project adapter. Do not
depend on an untyped internal shape in a workflow API.

Sources: installed `@medusajs/types/dist/product/service.d.ts` methods
`updateProductOptionValues`, installed `@medusajs/types/dist/product/common.d.ts`
`UpdateProductOptionValueDTO`, and [`product-module-service.ts#L1223-L1295`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/modules/product/src/services/product-module-service.ts#L1223-L1295).

### Product-specific Option Value subsets are separate pivots

Medusa 2.18.0 exposes `updateProductOptionValuesOnProduct`. It adds or removes
Option Value IDs from the Product-specific pivot. It does not change the
global Option Value row. It also refuses to remove an Option Value that a
Variant uses.

This gives a safe projection for a dynamic attribute: keep the native Option
Value and source mapping for history, then change the Product-specific subset
only when no native Variant uses that value. If a historical Variant still uses
the value, retain the relation and hide the source Variant through the Catalog
availability projection.

Source: [`product-module-service.ts#L1809-L1947`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/modules/product/src/services/product-module-service.ts#L1809-L1947).

### Soft-delete is not Catalog archive

`deleteProductVariantsWorkflow` removes remote links, deletes inventory items
that belong only to the deleted Variants, and soft-deletes the Variant rows.
The delete step compensates by restoring the Variant IDs.

This is the correct native behavior for an Operator deletion. It is not the
Catalog behavior for an archived or unsaleable Odoo Variant. Issue #131
requires the Catalog Mapping and Order history to remain. The Catalog workflow
must retain the native Variant and its mapping, then project unavailable state
through a separate Catalog-owned record or query seam.

Sources: [`delete-product-variants.ts#L54-L125`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/core-flows/src/product/workflows/delete-product-variants.ts#L54-L125) and [`delete-product-variants.ts#L14-L30`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/core-flows/src/product/steps/delete-product-variants.ts#L14-L30).

### Product publication is Product-level only

`ProductStatus` is `draft`, `proposed`, `published`, or `rejected`. The Store
Product middleware applies `published` as the default filter. The Cart workflow
rejects a Variant when its Product is not published. It does not check a
Variant-level status.

Sources: [`common.ts#L5-L9`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/types/src/product/common.ts#L5-L9), [`middlewares.ts#L65-L124`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/medusa/src/api/store/products/middlewares.ts#L65-L124), and [`get-variants-and-items-with-prices.ts#L80-L159`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/core-flows/src/cart/workflows/get-variants-and-items-with-prices.ts#L80-L159).

Inventory confirmation checks `manage_inventory`, `allow_backorder`, and
Inventory Item levels. It does not check source sale eligibility or a Variant
active flag.

Source: [`prepare-confirm-inventory-input.ts#L12-L47`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/core-flows/src/cart/utils/prepare-confirm-inventory-input.ts#L12-L47).

Medusa therefore cannot represent “one Product is published, but one Variant
is archived, unsaleable, or a new authoring draft” with native Product status.
Do not overload `manage_inventory` for this state. It changes stock behavior.

### Prices accept exact decimal input

`CreateMoneyAmountDTO.amount` and `UpdateMoneyAmountDTO.amount` accept
`BigNumberInput`, which includes strings. The Odoo bridge returns its Decimal
as a string. The Catalog workflow can pass that string to the native price
workflow without converting it through a JavaScript `number`.

Sources: [`money-amount.ts#L55-L109`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/types/src/pricing/common/money-amount.ts#L55-L109) and [`big-number.ts#L12-L23`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/types/src/totals/big-number.ts#L12-L23).

The Variant workflows update Price Sets only when `prices` is present. This
lets a barcode or internal-reference update omit the pricing path.

Source: [`update-product-variants.ts#L183-L245`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/core/core-flows/src/product/workflows/update-product-variants.ts#L183-L245).

## Current extension patterns

### Mercur: normalized source attributes with native mirrors

Mercur runs on Medusa `2.18.0` at commit `d2c8a5ab`. Its custom
`ProductAttribute` model stores its own Attribute ID, name, variant-axis flag,
and a `product_option_id` mirror. Its `ProductAttributeValue` model stores its
own Value ID, name, and a `product_option_value_id` mirror.

Sources: [`product-attribute.ts`](https://github.com/mercurjs/mercur/blob/d2c8a5abbd0610de3ad20eac449877e342449d69/packages/core/src/modules/product-attribute/models/product-attribute.ts) and [`product-attribute-value.ts`](https://github.com/mercurjs/mercur/blob/d2c8a5abbd0610de3ad20eac449877e342449d69/packages/core/src/modules/product-attribute/models/product-attribute-value.ts).

Mercur defines read-only links from its Attribute and Value IDs to native
Product Option and Option Value IDs. The custom module owns the source model.
The Product Module owns its native records.

Sources: [`product-attribute-option-mirror-link.ts`](https://github.com/mercurjs/mercur/blob/d2c8a5abbd0610de3ad20eac449877e342449d69/packages/core/src/links/product-attribute-option-mirror-link.ts) and [`product-attribute-value-option-value-mirror-link.ts`](https://github.com/mercurjs/mercur/blob/d2c8a5abbd0610de3ad20eac449877e342449d69/packages/core/src/links/product-attribute-value-option-value-mirror-link.ts).

Its workflows create or update the native Option first, read the resulting
native IDs, then store those IDs on the custom Value rows. Another workflow
translates custom Value IDs to native Option Value IDs before it updates a
Product-specific subset. This is the closest current source pattern for the
Odoo attribute/value projection.

Sources: [`create-product-attribute-values.ts`](https://github.com/mercurjs/mercur/blob/d2c8a5abbd0610de3ad20eac449877e342449d69/packages/core/src/workflows/product-attribute/workflows/create-product-attribute-values.ts) and [`update-product-attributes-on-product.ts`](https://github.com/mercurjs/mercur/blob/d2c8a5abbd0610de3ad20eac449877e342449d69/packages/core/src/workflows/product-attribute/workflows/update-product-attributes-on-product.ts).

### Medusa first-party product-builder example

The current first-party `product-builder` example defines a custom DML module
with a Product Builder row and child rows. It links the custom Product Builder
to Product through `defineLink`. Its `createProductBuilderStep` returns the
created record as both output and compensation data. Its upsert workflow keeps
module CRUD, remote links, and nested update steps inside one workflow.

Sources: [`product-builder.ts`](https://github.com/medusajs/examples/blob/aae76657952903750dfcaaaf28b6746f20ab1af5/product-builder/src/modules/product-builder/models/product-builder.ts), [`service.ts`](https://github.com/medusajs/examples/blob/aae76657952903750dfcaaaf28b6746f20ab1af5/product-builder/src/modules/product-builder/service.ts), [`product-builder-product.ts`](https://github.com/medusajs/examples/blob/aae76657952903750dfcaaaf28b6746f20ab1af5/product-builder/src/links/product-builder-product.ts), [`create-product-builder.ts`](https://github.com/medusajs/examples/blob/aae76657952903750dfcaaaf28b6746f20ab1af5/product-builder/src/workflows/steps/create-product-builder.ts), and [`upsert-product-builder.ts`](https://github.com/medusajs/examples/blob/aae76657952903750dfcaaaf28b6746f20ab1af5/product-builder/src/workflows/upsert-product-builder.ts).

## Recommendations for issue #135

### Store stable source identity in a normalized Catalog module

The current #134 `CatalogMapping` has one row for a Product template and one
row for each Variant. It stores Odoo model, database ID, Integration Key,
Source Revision, fingerprint, Medusa Product or Variant ID, archive state, and
Sync Record ID. It does not store Attribute or Value identity. Its
`SyncRecord` also stores one Variant result and must grow for many Variants.

Add normalized rows rather than putting source identity in Product metadata:

- `CatalogAttributeMapping` belongs to the template Catalog Mapping. It stores
  the Odoo Attribute ID, current source label, variant creation mode, rank,
  and the Medusa Product Option ID when that Attribute is projected.
- `CatalogAttributeValueMapping` belongs to the Attribute Mapping. It stores
  the Odoo Attribute Value ID, Odoo template-value ID, current source label,
  and the Medusa Product Option Value ID when that Value is projected.
- `CatalogVariantAttributeValue` belongs to a Variant Catalog Mapping. It
  stores the exact Odoo Attribute ID and Value ID pair used by that source
  Variant. Enforce one Value per Attribute per source Variant.
- The Variant Catalog Mapping stores the current source availability snapshot.
  Issue #136 adds authoring state and the Storefront availability projection.
  Keep both concerns separate from native inventory.

Use unique indexes for:

- template Mapping plus Odoo Attribute ID;
- Attribute Mapping plus Odoo Value ID;
- Variant Mapping plus Odoo Attribute ID;
- Odoo Integration Key and Odoo model/database ID;
- Medusa Product Option and Medusa Option Value mirror IDs.

This shape follows the Mercur mirror pattern. It gives the Catalog workflow a
deep module with one source-identity vocabulary. It keeps Medusa's native
Option IDs as foreign references, not as source identity.

Do not use names, barcodes, internal references, option labels, or a JSON array
as the only identity key. JSON can keep a source snapshot, but it cannot give
the required uniqueness and lookup guarantees.

### Resolve the projection before native writes

Build one pure projection from the decoded `CatalogItem` and existing mapping
rows. The projection must:

1. reject duplicate Odoo Integration Keys;
2. reject an Attribute Value that is not declared by its Attribute;
3. reject a Variant with duplicate Attribute IDs;
4. reject a missing required projected Attribute Value;
5. classify each Attribute as `always`, `dynamic`, or `never`;
6. compute the exact source combination for every Variant; and
7. reject two source Variants that collapse to one projected native
   combination.

The last rule matters when two `never` or dynamic dimensions differ. Medusa
rejects duplicate native Option combinations. The Catalog workflow must report
an explicit source conflict before it writes a second Variant.

### Use Product Options for every native Variant axis

`always` Attributes become Product Options with all declared source Values.
An existing `dynamic` Attribute that appears in a source Variant also needs a
native Product Option if its distinction must survive in Medusa's Variant
relation. Create only the dynamic Values present in current source Variants.
When a new dynamic combination adds a Value, create or resolve its native
Option Value, link it to the Product-specific subset, then create the Variant.

This is a Medusa constraint, not a change to Odoo semantics. Native Variant
creation resolves an `options` object by Option title and Value label, and it
expects one value for each Product Option. A design that keeps dynamic
Attributes only in metadata cannot represent two Variants with different
dynamic Values under the same `always` combination.

`never` Attributes stay in `CatalogVariantAttributeValue` and source metadata.
Do not expose them as Product Options until a later Storefront decision.

The hidden `Configuration = Default` Option remains necessary for a
variant-less Product. It is not a substitute for a real dynamic axis when
multiple source combinations exist.

### Create many Variants in one ordered workflow

For a new Product:

1. preflight the complete source graph and source identity;
2. create the Product with all projected Options and Values;
3. create every valid source Variant in one
   `createProductsWorkflow.runAsStep` call;
4. map returned Variant IDs by the deterministic input order and Odoo
   Integration Key;
5. write Attribute and Value mappings, source combinations, and Variant State;
6. create Product and Product Variant links; and
7. complete the Sync Record only after every local projection succeeds.

For a Product that already exists, create new Variants with
`createProductVariantsWorkflow` after the Option and Product-specific Value
graph is ready. Keep the input sorted by Odoo Variant Integration Key or Odoo
database ID. Never find the new native Variant by name, barcode, or internal
reference.

Keep each imported Product in Medusa's native draft status when a new source
Variant arrives. Native Medusa has no Variant draft field. Issue #136 adds the
durable authoring and publication gate before imported Products can publish.

### Resync existing Variants by mapping ID

For each source Variant, resolve its existing Catalog Mapping by Odoo
Integration Key. Verify that the model and database ID also match. A missing
mapping creates a new Variant. A key that points to another Odoo record is an
identity conflict. A database ID that points to another Integration Key is
also a conflict.

Update an existing native Variant by the stored Medusa Variant ID. Omit
`options` for scalar-only changes such as barcode, SKU, and price. This keeps
the existing Option Value relation and skips the full Product combination scan.
Include a complete current `options` map only when the source combination
changes. Build that map from the stored native Option and Option Value IDs and
current labels. Never use the source label as the lookup key.

Update source-owned fields only. A barcode change updates `barcode`. An
internal-reference change updates `sku`. A price change updates the linked
Price Set with the Odoo Decimal string. A conflicting native unique index stops
the sync and leaves a visible Sync Record error.

Do not overwrite Medusa-owned title, description, Variant information, media,
SEO, merchandising order, or Authoring State during a resync. Source labels
needed for the structural Option projection are separate from that editorial
data.

### Preserve native IDs when labels change

Resolve a source Attribute by `CatalogAttributeMapping`. Update its native
Product Option title by native Option ID. Resolve a source Value by
`CatalogAttributeValueMapping`. Update its native Option Value label by native
Option Value ID.

Do not send a complete list of new labels to an API that can only match by
label. That path can create a new Option Value, then fail to update existing
Variants. Use the public ID-based `updateProductOptionValues` operation behind
a narrow Catalog Product adapter, or a project workflow step with the same
typed contract.

If two source Values change to the same label, the native unique index rejects
the write. Report a source conflict. Do not merge the source Value mappings.

### Archive and reactivate without deletion

When Odoo reports `active = false` or `saleOk = false`, retain the Catalog
Mapping, source combination, native Variant, Option Value relations, and Order
history. Set the Catalog Variant State to unavailable. Do not call
`deleteProductVariantsWorkflow` and do not set `manage_inventory = false` as a
proxy for availability.

When Odoo reports both flags as available again, clear the unavailable state.
Keep the Product publication state unchanged. The Store API and Cart path must
filter or reject the Variant from the Catalog Variant State projection. The
Storefront must not call Odoo to decide this state.

The exact Storefront seam needs an implementation decision in #135. A custom
Catalog query/filter layer is preferable to a post-response filter because
the Cart workflow also needs the same rule. A Product-level status change is
not sufficient because it hides every Variant.

### Keep compensation symmetric

Create steps return the IDs of new rows. Their compensation deletes only rows
created by that execution. Link steps dismiss only links created by that
execution. Mapping and Attribute Mapping create steps must use the same
pattern.

Resync steps also need previous values for existing rows. Record the previous
source snapshot, state, labels, and native scalar fields before mutation. If a
later step fails, restore those values. Do not delete an existing mapping or
native Variant during compensation.

Advance `last_synced_at`, Source Revision, and source fingerprint in the final
success step. Keep the durable Sync Record outside compensation so an error
remains visible. Never compensate the Odoo read. Medusa does not write Odoo.

### Use exact decimal prices

The current #134 code converts the bridge Decimal to `Number` before it creates
the Price Set. Issue #131 requires exact commercial amounts. Pass the decoded
Decimal string to the native `prices` input. Validate non-negative input at the
bridge contract boundary and keep the decimal representation through the
workflow.

### Recommended workflow seam

Keep the Admin route thin. Use one Catalog workflow that accepts a decoded
Catalog Item, the source revision, and the existing Product or Mapping lookup.
Keep pure source projection outside Medusa mutation steps. The mutation steps
then have clear inputs:

- `prepareCatalogProjection`: source graph, source-to-native plan, and
  conflict list;
- `syncCatalogOptions`: create or update native Options and Values by stored
  IDs;
- `syncCatalogVariants`: create missing Variants and update existing Variants
  by stored Medusa IDs;
- `syncCatalogAvailability`: store the current source archive or sale state;
- `persistCatalogMappings`: source identity and source-combination rows;
- `createCatalogLinks`: Product and Product Variant links; and
- `completeCatalogSync`: final source revision, fingerprint, and result IDs.

The workflow can wrap native Medusa workflows with `runAsStep`. The Catalog
module owns source mappings and state. The Product Module owns native Product,
Variant, Option, and Option Value records. The Odoo bridge remains one typed
read port.

## Highest-seam integration tests

Use a fake `OdooBridgeGateway` and real Medusa module services. Test the
authenticated Admin route or the public Catalog command that the route calls.
Do not test only pure helpers or the ORM service.

The bridge contract suite must send the same normalized fixtures to staging
Odoo. The Medusa suite must not make unexpected network calls.

Cover these cases:

- variant-less Product and the hidden `Configuration = Default` Option;
- one Attribute with several Values and every source combination;
- multiple Attributes with the full valid combination set;
- `always` Attributes, existing `dynamic` combinations, and `never` source
  metadata;
- deterministic many-Variant creation and mapping by Integration Key;
- a new Odoo Variant that creates one new native Variant while the Product
  remains a draft;
- a resync that changes only price, barcode, and internal reference;
- an Attribute label and Value label change that preserves native Option,
  Option Value, Variant, and Catalog Mapping IDs;
- an archived Variant that becomes unavailable while its mapping remains;
- a reactivated Variant that becomes available again;
- same source Integration Key with changed name, barcode, or internal reference;
- a new Integration Key with a colliding name, barcode, or internal reference;
- duplicate projected combinations and mismatched source IDs as conflicts;
- a conflicting native SKU or barcode as a visible failure;
- exact decimal price values without binary-number rounding;
- failure after native creation, after mapping creation, and after link
  creation; and
- replay of the same Sync Record and conflict for the same operation ID with a
  different fingerprint.

Assert the durable state after each failure. New native rows and mappings must
be compensated. Existing rows must restore their previous values. The Sync
Record must remain failed and safe to inspect.

Medusa's own tests give the required assertions for Variant update
compensation, scalar-only Option preservation, duplicate combinations, and
Option Value removal validation:

- [`update-product-variants.spec.ts#L49-L150`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/integration-tests/modules/__tests__/product/workflows/update-product-variants.spec.ts#L49-L150);
- [`product-variants.spec.ts#L447-L470`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/modules/product/integration-tests/__tests__/product-module-service/product-variants.spec.ts#L447-L470);
- [`product-variants.spec.ts#L614-L720`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/packages/modules/product/integration-tests/__tests__/product-module-service/product-variants.spec.ts#L614-L720); and
- [`update-product-options.spec.ts#L49-L174`](https://github.com/medusajs/medusa/blob/b574ef20cbd58bc6a3361a3da969070e6ca97846/integration-tests/modules/__tests__/product/workflows/update-product-options.spec.ts#L49-L174).

## Decisions that must be explicit before coding

1. Treat dynamic Attributes that appear in Variants as native Product Options.
   This is the only native shape that preserves multiple dynamic combinations
   without a hidden identity axis.
2. Add normalized Attribute, Value, and Variant-combination rows to the
   Catalog module. Keep Odoo IDs as the identity source.
3. Preserve native Option and Option Value IDs across label updates.
4. Keep archived and unsaleable Variants as native rows. Store source
   availability on the Variant mapping. Issue #136 owns Storefront and Cart
   projection.
5. Split native Variant creation from existing Variant updates. Do not use the
   parallel batch workflow as the resync coordinator.
6. Pass Odoo Decimal strings to Price Set workflows.
7. Make the highest-seam integration test use a fake bridge and real Medusa
   modules, then run the same contract fixtures against staging Odoo.

These decisions satisfy the #135 acceptance criteria and preserve the
ownership split in #131 and ADR-0030.
