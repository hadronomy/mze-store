# Catalog intake interface design

Date: 2026-08-21

Issue: [#134](https://github.com/hadronomy/mze-store/issues/134)

Evidence: [Medusa catalog intake primary sources](./medusa-catalog-intake-primary-sources.md)

## Caller and seam

The only caller in this slice is an authenticated Admin route. It starts one
bounded Catalog Item import. The Storefront is not a caller and cannot resolve
the Odoo bridge.

The selected public application interface has one operation:

```ts
export type ImportCatalogItemInput = Readonly<{
  operationId: string;
  cursor?: SourceRevision | null;
  signal?: AbortSignal;
}>;

export type ImportCatalogItemResult = Readonly<{
  disposition: "created" | "replayed";
  syncRecordId: string;
  productId: string;
  variantId: string;
  catalogMappingIds: Readonly<{
    template: string;
    variant: string;
  }>;
  sourceRevision: SourceRevision;
  nextCursor: SourceRevision | null;
}>;

export function importCatalogItem(
  container: MedusaContainer,
  input: ImportCatalogItemInput,
): Promise<ImportCatalogItemResult>;
```

The operation accepts trusted, decoded input. The Admin route decodes its JSON
cursor and obtains `operationId` from the idempotency header.

## Common call

```ts
const imported = await importCatalogItem(req.scope, {
  operationId: operationIdFromRequest(req, "catalog-import"),
  cursor: req.validatedBody.cursor ?? null,
});

const product = await refetchImportedProduct(req.scope, imported.productId);

res.status(200).json({
  product,
  catalog_import: toCatalogImportResponse(imported),
});
```

The route does not resolve module CRUD services, calculate fingerprints, call
Odoo, construct Product input, or create links.

## Replay and conflict

```ts
const first = await importCatalogItem(scope, {
  operationId: "catalog-import--one",
  cursor: null,
});

const replay = await importCatalogItem(scope, {
  operationId: "catalog-import--one",
  cursor: null,
});

assert.equal(replay.disposition, "replayed");
assert.equal(replay.productId, first.productId);
```

The second call does not call Odoo or run Product creation.

The same operation ID with another cursor has another request fingerprint. It
fails with a Medusa conflict before remote or local work. A failed terminal
operation with the same fingerprint replays the same stored error type, code,
and safe message. Issue #134 does not silently retry it. After source repair,
the Operator uses a new operation ID. Issue #137 can add an explicit retry
command with its own state transition.

## Expected failure and recovery

```ts
try {
  await importCatalogItem(scope, {
    operationId: "catalog-import--invalid-source",
    cursor: null,
  });
} catch (error) {
  if (MedusaError.isMedusaError(error) && error.code === "catalog_source_rejected") {
    // The failed Sync Record is durable. No Product survived compensation.
    // Repair Odoo and use a new operation ID.
    return;
  }

  throw error;
}
```

Expected failures use Medusa error types and stable catalog error codes:

- `catalog_operation_conflict`;
- `catalog_operation_in_progress`;
- `catalog_source_empty`;
- `catalog_source_rejected`;
- `catalog_identity_conflict`;
- `catalog_source_unavailable`;
- `catalog_import_cancelled`.

The Sync Record stores the error type, code, and safe message. Unknown defects
remain defects. The operation still tries to mark their Sync Record as failed,
but it does not convert them into an expected domain error.

## Interruption

```ts
const controller = new AbortController();
const pending = importCatalogItem(scope, {
  operationId: "catalog-import--cancelled",
  signal: controller.signal,
});

controller.abort();
await pending;
```

The signal interrupts the remote bridge read. The operation records a durable
cancelled failure. Once the local workflow starts, Medusa owns completion and
compensation. A disconnected HTTP caller does not abandon a half-written
Product.

## Resource ownership and replacement

The Catalog Sync module owns one application-scoped `OdooBridgeClient`. It
loads that client on its first Catalog read because the Medusa server is
CommonJS and Effect 4 is ESM-only. Its module options accept the normal
production Odoo options and an optional `OdooBridgeGateway` replacement at the
same seam:

```ts
export type CatalogSyncModuleOptions = Readonly<{
  odoo: OdooBridgeOptions;
  gateway?: OdooBridgeGateway;
}>;
```

Production omits `gateway`. Tests and another owned adapter can supply it. The
module closes only the client it creates. Medusa calls the module shutdown
hook. Routes and workflows do not call `close`.

```ts
const fakeGateway: OdooBridgeGateway = {
  readCatalogBatch: async () => Result.succeed(validCatalogBatch),
};
```

The gateway is the only external port. PostgreSQL, the Medusa Product module,
links, and the workflow engine stay behind their existing Medusa interfaces.

## Internal division

```text
Admin route
  -> importCatalogItem
       -> Redis operation lock
       -> create or replay durable Sync Record
       -> Catalog Sync module reads Odoo with limit 1
       -> validate and fingerprint one Catalog Item
       -> preflight Odoo and Medusa identities
       -> createCatalogProductWorkflow
            -> createProductsWorkflow.runAsStep
            -> updateProductOptionsWorkflow.runAsStep
            -> create two Catalog Mappings
            -> create Product and Product Variant links
            -> complete Sync Record
```

`importCatalogItem` lives with the workflow facade. It follows the nearby Tax
Rate Audit pattern: lock and replay outside the workflow, compensated commerce
mutation inside it.

The custom workflow owns all local writes that must roll back together. The
Sync Record exists before the remote read and is never deleted by
compensation. On a downstream failure, the Product workflow deletes the new
Product, Variant, option, inventory and price records; the mapping step deletes
the two mappings; and `createRemoteLinkStep` dismisses the two links.

## Data invariants

One successful first-slice import creates:

- one draft Product;
- one Variant;
- one exclusive `Configuration = Default` option;
- option metadata that marks it hidden and source-generated;
- one template Catalog Mapping;
- one Variant Catalog Mapping;
- one succeeded Sync Record;
- one Product link and one Product Variant link.

The database enforces uniqueness for:

- Sync Record operation ID;
- Odoo Integration Key;
- Odoo model plus database ID;
- template Mapping Product ID;
- Variant Mapping Variant ID.

The Catalog Mapping stores the Odoo identity, Source Revision, source
fingerprint, Medusa IDs, archive flag, Sync State, and last successful sync.
The link rows provide query-graph traversal. The Mapping fields provide durable
replay and audit data. The creation workflow writes both in one compensating
unit.

## Alternatives

### Operation handle

`begin`, `execute`, `inspect`, `cancel`, and `close` made request-owned state
explicit. Medusa already owns module lifetime and workflow state, so the handle
made the common route harder without adding control needed by #134.

### Workflow as the only public interface

This shape matched Medusa composition. Reusing the operation ID as the workflow
transaction ID could let engine replay happen before the domain fingerprint
check. It also forced a non-serializable `AbortSignal` into workflow concerns.

### Full persistence ports

Separate Sync Record and Catalog Mapping repository ports improved isolation on
paper. Medusa's generated module service already is the local-substitutable
persistence boundary. Wrapping it added shallow interfaces and duplicated CRUD
contracts.

### Selected hybrid

The selected command keeps one caller step. It retains a real Adapter only at
the Odoo boundary, uses the proven local replay facade, and leaves compensated
cross-module mutation to Medusa workflows. The interface can accept the #135
multi-Variant projection later without changing the Admin caller. #137 can add
explicit retry and inspection operations without weakening this command's
terminal replay rule.
