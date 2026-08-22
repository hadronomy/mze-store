# Multi-Variant Catalog Synchronization Interface

Issue [#135](https://github.com/hadronomy/mze-store/issues/135) extends Catalog intake from one
variant-less Product to complete Odoo Variant sets. This note records the caller contract and the
module boundary before implementation.

The design follows the repository API rules, ADR-0030, and the pinned Medusa 2.18.0 source. The
supporting source study is in
[`medusa-multi-variant-catalog-primary-sources.md`](./medusa-multi-variant-catalog-primary-sources.md).

## Common call

The Admin route calls one command. It does not select create or resync behavior.

```ts
const result = await synchronizeCatalogItem(req.scope, {
  operationId: operationIdFromRequest(req, "catalog-import"),
  cursor: req.validatedBody.cursor ?? null,
  signal: disconnect.signal,
});
```

The public contract is:

```ts
export type SynchronizeCatalogItemInput = Readonly<{
  operationId: string;
  cursor?: SourceRevision | null;
  signal?: AbortSignal;
}>;

export type CatalogVariantSynchronization = Readonly<{
  integrationKey: OdooIntegrationKey;
  odooVariantId: OdooVariantId;
  medusaVariantId: string;
  catalogMappingId: string;
  disposition: "created" | "updated" | "unchanged" | "archived" | "reactivated";
  availability: "available" | "unavailable";
}>;

export type SynchronizeCatalogItemResult = Readonly<{
  disposition: "created" | "updated" | "unchanged" | "replayed";
  syncRecordId: string;
  productId: string;
  templateCatalogMappingId: string;
  variants: ReadonlyArray<CatalogVariantSynchronization>;
  sourceRevision: SourceRevision;
  nextCursor: SourceRevision | null;
}>;

export function synchronizeCatalogItem(
  container: MedusaContainer,
  input: SynchronizeCatalogItemInput,
): Promise<SynchronizeCatalogItemResult>;
```

The Variant result order matches the source order. Replay returns the stored IDs and effects, with
only the top-level disposition changed to `replayed`. It does not call Odoo or run a Product
workflow.

Expected failures reject with `MedusaError`. The stable error codes are:

- `catalog_operation_conflict`
- `catalog_operation_in_progress`
- `catalog_source_empty`
- `catalog_source_rejected`
- `catalog_source_unavailable`
- `catalog_identity_conflict`
- `catalog_structure_conflict`
- `catalog_source_missing_variant`
- `catalog_import_cancelled`

Unknown defects stay unknown defects. Public errors do not contain credentials, request headers,
raw Odoo responses, or secret-bearing causes.

Cancellation applies to the remote read and validation phase. Once the local workflow starts, the
workflow completes or compensates. The Catalog Sync module owns the application-scoped Odoo bridge
client and closes only the client that it created.

## Projection and identity rules

Odoo Integration Keys and Odoo database IDs identify Product templates and Variants. Names,
barcodes, internal references, attribute labels, and value labels do not identify them.

The projection applies these rules:

- `always` attributes become visible Medusa Product Options.
- `dynamic` attributes become hidden, source-generated Product Options. Only existing Odoo
  combinations become Medusa Variants.
- Source-generated Product Options are exclusive to their Product. Two Products can use the same
  source attribute label without sharing option identity.
- `never` attributes and values stay in Catalog Mapping sidecars. They do not become Product
  Options.
- A Product with no projected attribute gets the hidden `Configuration = Default` option.
- A new Odoo Variant Integration Key creates a new Medusa Variant. Imported Products stay in
  Medusa's `draft` status until issue #136 adds the explicit authoring and publication gate.
- A changed barcode or internal reference updates only the mapped Variant.
- A changed source label updates the source snapshot. It does not overwrite Operator presentation
  after first intake.
- Inactive or unsaleable source records set Catalog Mapping availability to unavailable. The
  Medusa records and mappings remain. Issue #136 owns the Storefront availability projection and
  Authoring State.
- A missing mapped Variant in a complete Catalog Item is a visible hard-deletion conflict.
- A change between `always`, `dynamic`, and `never` is a structure conflict. It needs an explicit
  migration policy.

Before a Product mutation, validation proves that all referenced attribute and value IDs exist,
each projected attribute occurs once per Variant, projected combinations are unique, labels are
valid Medusa option keys, Integration Keys are distinct, and prices are finite non-negative
amounts.

## Durable data

`CatalogMapping` remains the template and Variant identity record. Three normalized sidecars keep
attribute identity queryable:

```text
CatalogAttributeMapping
  template Catalog Mapping ID
  Odoo attribute ID
  creation mode
  source label
  Medusa Product Option ID or null

CatalogAttributeValueMapping
  Catalog Attribute Mapping ID
  Odoo value ID
  Odoo template value ID
  source label
  Medusa Product Option Value ID or null

CatalogVariantAttributeValue
  Variant Catalog Mapping ID
  Catalog Attribute Mapping ID
  Catalog Attribute Value Mapping ID
```

Database indexes enforce each source identity and each Medusa identity. Medusa metadata marks
hidden structural options, but it is not an identity constraint.

`SyncRecord.result` stores the validated, immutable success projection as JSON. Replay decodes this
value before use. This JSON is an operation result, not an editable domain model, so a normalized
result table would add joins without a stronger invariant.

## Internal composition

The command hides two local paths:

```text
synchronizeCatalogItem
  -> operation lock and durable Sync Record
  -> CatalogSource
  -> source validation
  -> Product Integration Key lock
  -> mapping lookup and pure reconciliation plan
  -> createCatalogProductWorkflow or updateCatalogProductWorkflow
  -> durable result
```

Initial intake uses `createProductsWorkflow` with all initial Product Options and Variants. Resync
uses `createProductVariantsWorkflow` for new Variants and `updateProductVariantsWorkflow` for
Odoo-owned Variant fields and prices. Catalog Mapping writes use compensating custom steps. The
Sync Record stays outside compensation so an Operator can inspect the outcome.

The Medusa module service is the persistence seam. A second repository interface would repeat its
CRUD surface without hiding policy. `CatalogSource` is the application port. Its production Adapter
owns the CommonJS-to-ESM bridge boundary and delegates to `OdooBridgeGateway`. Module options accept
a test source through the same port.

## Compared designs

Four designs were compared in parallel.

### Separate create and resync commands

This design makes lifecycle state explicit. It also gives the caller an invalid choice. A caller
can request create for a mapped Product or resync for an unmapped Product. Both commands repeat
source, lock, replay, and failure policy.

### Capability planner as the public interface

This design exposes a typed reconciliation plan. It helps uncommon repair tools, but it makes the
Admin route understand Product Options, source modes, mappings, and Medusa IDs. It also creates a
second trusted input that can bypass the Bridge Contract.

### Workflow as the public interface

This design exposes Medusa workflow input and transaction details. It gives good compensation, but
it leaks workflow mechanics into the route and cannot accept an `AbortSignal` as stored workflow
data.

### One synchronization command

The selected design gives the common caller one operation. It hides create versus resync,
fingerprinting, identity matching, projection, native workflows, compensation, and replay. A pure
private planner keeps source validation and change calculation separate from side effects.

This design has the best depth and locality. Its main cost is the normalized sidecar schema. Those
rows pay for stable Odoo attribute identity, label changes, Variant combination checks, and future
reconciliation without parsing editable metadata.
