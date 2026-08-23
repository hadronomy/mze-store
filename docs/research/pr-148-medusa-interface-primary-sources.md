# PR #148 Medusa interface research

Scope: the complete PR stack through `d5bd5a7`, with Medusa `2.18.0` as the
pinned version. This note checks the Admin route, workflow, step, module, link,
Query, Catalog synchronization, Product Authoring, and OdooBridge call trees.
It uses the stack source, the exact Bun-isolated Medusa `2.18.0` declarations,
and official Medusa documentation. The installed source was read from
`/private/tmp/mze-pr128.II8kiG`; its package versions match the stack lockfile.

## Findings

### 1. Keep the module, workflow, and Query seams

The stack has the right ownership shape. `CatalogSyncModule` exports a narrow
`Pick` of its service, Product and Authoring stay in their own modules, and
cross-module reads use Query. The three Product links are defined in
`src/links`. Medusa documents Query for reads and links for cross-module
relations. Keep this boundary. Do not let an Admin route call a generated
service method across module ownership.

Sources: `apps/medusa/src/modules/catalog-sync/service.ts:958-969`,
`apps/medusa/src/links/product-catalog-mapping.ts:1-8`,
`apps/medusa/src/links/product-product-authoring.ts:1-8`,
`apps/medusa/src/links/product-variant-catalog-mapping.ts:1-8`,
[Query](https://docs.medusajs.com/learn/fundamentals/module-links/query), and
[module isolation](https://docs.medusajs.com/learn/fundamentals/modules/isolation).

### 2. `query.graph` is a runtime boundary. Decode every Product projection

The installed `2.18.0` Query type returns `any[]` when an entry point has no
generated `RemoteQueryEntryPoints` augmentation. The installed augmentation is
empty. The synchronizer then casts `data` directly to
`CurrentCatalogProduct`, and the import route sends a Query result without a
schema check. Promotion already uses a Zod schema; use the same pattern for
the synchronizer and the route response. This removes a silent field or
nullability drift from the public API.

Sources: installed
`/private/tmp/mze-pr128.II8kiG/node_modules/.bun/@medusajs+types@2.18.0+3f54c1b165eee1a7/node_modules/@medusajs/types/dist/modules-sdk/remote-query.d.ts:12-25`,
installed
`/private/tmp/mze-pr128.II8kiG/node_modules/.bun/@medusajs+types@2.18.0+3f54c1b165eee1a7/node_modules/@medusajs/types/dist/modules-sdk/remote-query-entry-points.d.ts:1-4`,
`apps/medusa/src/catalog/synchronize-catalog-item.ts:375-394`,
`apps/medusa/src/api/admin/odoo/catalog-imports/route.ts:44-62`,
`apps/medusa/src/workflows/authoring-promote.ts:31-94`, and
[Query](https://docs.medusajs.com/learn/fundamentals/module-links/query).

### 3. Keep the Link step name for the pinned release

The current stack imports `createRemoteLinkStep`. Medusa's current docs say
that the Remote Link container was deprecated in v2.2, but the workflow steps
are still named `createRemoteLinkStep`, `dismissRemoteLinkStep`, and
`removeRemoteLinkStep`. The exact installed `2.18.0` core-flows declaration
exports `createRemoteLinkStep`; it does not export a `createLinkStep`. Keep the
current import for this pin. If code resolves the Link service directly, use
`ContainerRegistrationKeys.LINK`. Replacing the workflow helper name during
this PR would create developer friction and break the pinned API.

Sources: `apps/medusa/src/workflows/catalog-product-import.ts:14-18,317-346`,
`apps/medusa/src/workflows/catalog-product-update.ts:1-20,586-603`,
installed
`/private/tmp/mze-pr128.II8kiG/node_modules/.bun/@medusajs+core-flows@2.18.0+eff93d1321803b0c/node_modules/@medusajs/core-flows/dist/common/steps/create-remote-links.d.ts:9-18`,
and [Link](https://docs.medusajs.com/learn/fundamentals/module-links/link).

### 4. Make Product status a closed type at the Query boundary

`ProductProjectionSchema` accepts any string for `status`. Promotion stores it
as `string`, and compensation maps unknown values to `draft`. The update
workflow uses the same `String(data[0]?.status ?? ProductStatus.DRAFT)` pattern.
Medusa `2.18.0` defines Product status as the closed union
`draft | proposed | published | rejected` and exposes the matching
`ProductStatus` enum. Decode that union, then use one exhaustive status mapper.
An invalid Query value must fail the gate, not silently restore a draft.

Sources: `apps/medusa/src/workflows/authoring-promote.ts:33-45,155-183`,
`apps/medusa/src/workflows/catalog-product-update.ts:626-661`, installed
`/private/tmp/mze-pr128.II8kiG/node_modules/.bun/@medusajs+utils@2.18.0+2b4703627e686891/node_modules/@medusajs/utils/dist/product/enums.d.ts:1-6`,
installed
`/private/tmp/mze-pr128.II8kiG/node_modules/.bun/@medusajs+types@2.18.0+3f54c1b165eee1a7/node_modules/@medusajs/types/dist/product/common.d.ts:5-41`.

### 5. Serialize Product Authoring promotion by Product

Promotion reads `ready` in `validatePromotion`, then reads `ready` again in
`markPublished` before it updates the row to `published`. The route adds no
lock. Two Operators can pass the read before either update. Put one Product-key
lock around validation, Authoring transition, and Product status projection, or
make the module transition conditional on `state = ready`. Use one lock seam;
Medusa warns against acquiring a workflow lock and a step lock in the same
execution. The existing compensation steps are the right rollback shape.

Sources: `apps/medusa/src/workflows/authoring-promote.ts:47-153`,
`apps/medusa/src/api/admin/products/[id]/promote/route.ts:4-18`,
`apps/medusa/src/modules/product-authoring/service.ts:75-90`, and
[locking operations in workflows](https://docs.medusajs.com/learn/fundamentals/workflows/locks).

### 6. Move Catalog completion into a recoverable workflow boundary

The Product create or update workflow completes first. The synchronizer then
calls `finishSync` outside that workflow. `finishSync` is a separate
transaction. If it fails after Product, mapping, and link writes commit, the
Sync Record stays `in_progress`. Every later request with that operation ID
then receives `catalog_operation_in_progress`; `resumeStart` has no stale-record
recovery path. Make completion a final workflow step with a retry policy, or
add a durable reconciler that can finish or dead-letter the record. Preserve
the operation fingerprint and result validation.

Sources: `apps/medusa/src/catalog/synchronize-catalog-item.ts:131-174`,
`apps/medusa/src/modules/catalog-sync/service.ts:165-214,756-775`, and
[workflow compensation](https://docs.medusajs.com/learn/fundamentals/workflows/compensation-function)
plus [step retries](https://docs.medusajs.com/learn/fundamentals/workflows/retry-failed-steps).

### 7. Treat locking and transactions as different contracts

The installed `ILockingModule.execute` contract acquires a lock, runs a job,
and accepts a timeout and shared context. It does not promise a database
transaction. The custom Catalog methods that need a transaction use
`@InjectTransactionManager` and `@MedusaContext`. The outer and nested locks
in the synchronizer therefore serialize callers but do not make the Odoo read,
Product workflow, links, projection, and Sync Record one atomic unit. Keep the
Odoo call outside a long database transaction. Pass `sharedContext` whenever a
transactional module method calls another transactional method, as Medusa
documents.

Sources: installed
`/private/tmp/mze-pr128.II8kiG/node_modules/.bun/@medusajs+types@2.18.0+3f54c1b165eee1a7/node_modules/@medusajs/types/dist/locking/index.d.ts:323-369`,
`apps/medusa/src/catalog/synchronize-catalog-item.ts:75-174`,
`apps/medusa/src/modules/catalog-sync/service.ts:145-227`, and
[database operations](https://docs.medusajs.com/learn/fundamentals/modules/db-operations).

### 8. Make the projection receipt truthful

The create projection writes Catalog Attribute Value mappings at lines
404-418, but its receipt reports `createdValueIds: []` at lines 452-461. The
update path records those IDs. Hard-delete foreign keys currently cascade, but
the receipt type promises a complete compensation record and the migration
comment says soft-delete compensation removes children explicitly. Record the
created value IDs in the create receipt, or remove that field and document a
single hard-cascade contract. Add a compensation test that checks all child
rows after a later workflow failure.

Sources: `apps/medusa/src/modules/catalog-sync/service.ts:230-276,380-462,652-661`,
`apps/medusa/src/modules/catalog-sync/types.ts:251-263`,
`apps/medusa/src/modules/catalog-sync/migrations/Migration20260822000000.ts:22-39`,
and installed
`/private/tmp/mze-pr128.II8kiG/node_modules/.bun/@medusajs+utils@2.18.0+2b4703627e686891/node_modules/@medusajs/utils/dist/modules-sdk/medusa-service.js:145-167`.

### 9. Return the Blocked Reason through the Authoring API

The model stores `blocked_reason`, the edit input accepts `blockedReason`, and
`editAuthoring` writes it. `ProductAuthoringRecordView` and `toView` omit it,
and the PUT route omits it from its response. An Operator can set a Blocked
Reason and then cannot read it through the public Admin API. Add a nullable
`blockedReason` to the domain view and `blocked_reason` to the response, or
make the field private by removing it from the public input.

Sources: `apps/medusa/src/modules/product-authoring/models/product-authoring.ts:4-14`,
`apps/medusa/src/modules/product-authoring/types.ts:28-45`,
`apps/medusa/src/modules/product-authoring/service.ts:59-72,122-131`, and
`apps/medusa/src/api/admin/products/[id]/authoring/route.ts:15-38`.

### 10. Preserve structured Odoo failures at the Medusa adapter

ADR-0030 requires the bridge to preserve Odoo's structured error name and
reason. The Effect/Result client provides tagged request failures, including
authentication, permission, rejected request, timeout, transport, and
unexpected status. `bridgeReadError` maps only a few validation failures and
aborts; every other tag becomes the same generic
`catalog_source_unavailable` error. This hides whether an Operator must fix
credentials, Odoo data, or connectivity. Map each expected tag to a stable
Catalog error code and a retryability class. Keep the safe structured reason
for logs and the Admin response contract.

Sources: `docs/adr/0030-odoo-medusa-sync-uses-a-typed-bridge-and-split-ownership.md:27-35`,
`packages/odoo-bridge/src/error.ts:44-100,188-224`,
`apps/medusa/src/modules/catalog-sync/catalog-source.ts:19-49`.

### 11. Make workflow inputs, outputs, and retries explicit

The edit workflow supplies `createWorkflow<EditAuthoringInput,
ProductAuthoringRecordView, unknown[]>`. The Catalog create, Catalog update,
and promotion workflows call `createWorkflow` without type parameters. The
installed SDK exposes `createWorkflow<TData, TResult, THooks>` and uses those
types for `.run`, `.runAsStep`, and the result. Add explicit input and result
types to the three workflows. The promotion POST also creates an automatic
transaction ID because it passes no `context.transactionId`; if callers need
retry-safe POST semantics, accept the same Idempotency-Key contract as Catalog
import and pass its operation ID. If promotion is intentionally single-use,
document the state-conflict response.

Sources: `apps/medusa/src/workflows/authoring-edit.ts:29-34`,
`apps/medusa/src/workflows/catalog-product-import.ts:45,454-456`,
`apps/medusa/src/workflows/catalog-product-update.ts:703-706`,
`apps/medusa/src/workflows/authoring-promote.ts:22-24,186-193`,
`apps/medusa/src/api/admin/products/[id]/promote/route.ts:4-11`,
installed
`/private/tmp/mze-pr128.II8kiG/node_modules/.bun/@medusajs+workflows-sdk@2.18.0+2b4703627e686891/node_modules/@medusajs/workflows-sdk/dist/utils/composer/create-workflow.d.ts:58-70`,
and installed
`/private/tmp/mze-pr128.II8kiG/node_modules/.bun/@medusajs+workflows-sdk@2.18.0+2b4703627e686891/node_modules/@medusajs/workflows-sdk/dist/helper/workflow-export.js:97-113`.

## Patterns to retain

- The Catalog import derives one operation ID from the standard and legacy
  idempotency headers, stores a request fingerprint, and replays a succeeded
  result. Sources: `apps/medusa/src/api/admin/idempotency.ts:5-25`,
  `apps/medusa/src/catalog/synchronize-catalog-item.ts:77-89`, and
  `apps/medusa/src/modules/catalog-sync/service.ts:107-135,756-814`.
- Product creation and update use Medusa core workflows through `runAsStep`,
  then add custom projection and compensation steps. This matches the
  Workflows SDK contract and the official nested workflow guidance. Sources:
  `apps/medusa/src/workflows/catalog-product-import.ts:317-346`, installed
  `/private/tmp/mze-pr128.II8kiG/node_modules/.bun/@medusajs+workflows-sdk@2.18.0+2b4703627e686891/node_modules/@medusajs/workflows-sdk/dist/utils/composer/type.d.ts:194-217`,
  and [nested workflows](https://docs.medusajs.com/learn/fundamentals/workflows/execute-another-workflow).
- OdooBridge gives the Medusa adapter a Promise-facing Result API, an Effect
  service, abort propagation, and idempotent async disposal. Keep that seam and
  inject `OdooBridgeGateway` at the Catalog module boundary in workflow tests.
  Sources:
  `packages/odoo-bridge/src/client.ts:16-52,75-127`,
  `apps/medusa/src/modules/catalog-sync/service.ts`, and
  `apps/medusa/integration-tests/catalog-synchronization-workflow.spec.ts`.
