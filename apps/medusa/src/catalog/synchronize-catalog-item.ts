import type {
  ILockingModule,
  IProductModuleService,
  Logger,
  MedusaContainer,
} from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  MedusaError,
  Modules,
  ProductStatus,
} from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import type {
  CatalogAttribute,
  CatalogBatch,
  CatalogItem,
  CatalogTemplate,
  CatalogVariant,
  SourceRevision,
} from "@mze-store/odoo-bridge";
import { decodeSourceRevision } from "@mze-store/odoo-bridge";
import { acquireLockStep, updateProductsWorkflow } from "@medusajs/medusa/core-flows";
import type { StepExecutionContext } from "@medusajs/framework/workflows-sdk";
import {
  StepResponse,
  WorkflowResponse,
  createStep,
  createWorkflow,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk";
import stringify from "fast-json-stable-stringify";
import { createHash, randomUUID } from "node:crypto";
import {
  CATALOG_SYNC_MODULE,
  catalogError,
  type CatalogIdentity,
  type CatalogProjectionReceipt,
  type CatalogStorefrontAvailabilitySnapshot,
  type CatalogSyncModule,
} from "~/modules/catalog-sync";
import type { CatalogSynchronizationResult } from "~/modules/catalog-sync";
import type { CatalogProjectionRecords } from "~/modules/catalog-sync/types";
import {
  PRODUCT_AUTHORING_MODULE,
  type ProductAuthoringModuleService,
} from "~/modules/product-authoring";
import {
  createCatalogProductWorkflow,
  type PreparedCatalogImport,
} from "~/workflows/catalog-product-import";
import {
  updateCatalogProductWorkflow,
  type CurrentCatalogProduct,
} from "~/workflows/catalog-product-update";
import { isCatalogTemplateUnavailable, isCatalogVariantUnavailable } from "./catalog-projection";
import { recordCatalogStepFailure } from "./record-catalog-step-failure";

export type SynchronizeCatalogItemInput = Readonly<{
  operationId: string;
  cursor?: Readonly<{ changedAt: string; productId: number }> | null;
}>;

export type SynchronizeCatalogItemResult = CatalogSynchronizationResult &
  Readonly<{ disposition: "created" | "updated" | "unchanged" | "replayed" }>;

type CatalogFingerprintInput =
  | Readonly<{
      operation: "catalog.synchronize";
      cursor: SourceRevision | null;
    }>
  | Readonly<{
      contractVersion: CatalogBatch["contractVersion"];
      item: CatalogItem;
      priceList: CatalogBatch["priceList"];
    }>;

const SerializedWorkflowErrorSchema = z.object({
  message: z.string(),
  type: z.string().optional(),
  code: z.string().optional(),
});

const CurrentCatalogProductSchema = z.object({
  id: z.string(),
  status: z.enum([
    ProductStatus.DRAFT,
    ProductStatus.PROPOSED,
    ProductStatus.PUBLISHED,
    ProductStatus.REJECTED,
  ]),
  options: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      values: z.array(z.object({ id: z.string(), value: z.string() })),
    }),
  ),
});

type StartedCatalogSynchronization = Readonly<{
  tag: "started";
  syncRecordId: string;
  cursor: SourceRevision | null;
}>;

type BegunCatalogSynchronization =
  | StartedCatalogSynchronization
  | Readonly<{ tag: "replayed"; result: CatalogSynchronizationResult }>;

type CatalogSynchronizationPlan =
  | Readonly<{ tag: "create"; prepared: PreparedCatalogImport }>
  | Readonly<{
      tag: "update";
      prepared: PreparedCatalogImport &
        Readonly<{ existing: CatalogProjectionRecords; product: CurrentCatalogProduct }>;
    }>
  | Readonly<{
      tag: "unchanged";
      prepared: PreparedCatalogImport;
      existing: CatalogProjectionRecords;
      result: CatalogSynchronizationResult;
    }>;

type CatalogSyncFailureReceipt = Readonly<{
  operationId: string;
  lockOwnerId: string;
  syncRecordId: string | null;
}>;

type BeginCatalogSynchronizationInput = Readonly<{
  request: SynchronizeCatalogItemInput;
  lockOwnerId: string;
}>;

type RefreshCatalogAvailabilityInput = Readonly<{
  productId: string;
  syncRecordId: string;
}>;

type RefreshCatalogAvailabilityResult = Readonly<{
  productId: string;
  productAvailable: boolean;
}>;

type SelectCatalogSynchronizationResultInput = Readonly<{
  begun: BegunCatalogSynchronization;
  created?: CatalogSynchronizationResult;
  updated?: CatalogSynchronizationResult;
  unchanged?: CatalogSynchronizationResult;
}>;

function decodeCursor(input: SynchronizeCatalogItemInput): SourceRevision | null {
  // The cursor is untrusted request input. Decode it once so every later step
  // receives the bridge's validated Source Revision.
  const cursor = input.cursor
    ? decodeSourceRevision({
        write_date: input.cursor.changedAt,
        id: input.cursor.productId,
      })
    : null;

  return cursor;
}

async function beginCatalogSynchronization(
  { request, lockOwnerId }: BeginCatalogSynchronizationInput,
  { container }: StepExecutionContext,
): Promise<StepResponse<BegunCatalogSynchronization, CatalogSyncFailureReceipt>> {
  const cursor = decodeCursor(request);
  const requestFingerprint = fingerprint({
    operation: "catalog.synchronize",
    cursor,
  });
  const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  const begun = await catalogSync.startSync({
    operationId: request.operationId,
    requestFingerprint,
  });
  if (begun.tag === "failed") {
    try {
      await demoteFailedCatalogProduct(container, catalogSync, begun.syncRecordId, lockOwnerId);
    } catch (thrown) {
      const error =
        thrown instanceof Error ? thrown : new Error("The failure projection returned no Error.");
      logFailureRecoveryError(container, begun.syncRecordId, error);
    }
    throw new MedusaError(
      begun.failure.type,
      begun.failure.message,
      begun.failure.code ?? undefined,
    );
  }
  if (begun.tag === "replayed") {
    return new StepResponse(
      { tag: "replayed", result: begun.result },
      { operationId: request.operationId, lockOwnerId, syncRecordId: null },
    );
  }

  return new StepResponse(
    { tag: "started", syncRecordId: begun.syncRecordId, cursor },
    { operationId: request.operationId, lockOwnerId, syncRecordId: begun.syncRecordId },
  );
}

async function compensateCatalogSynchronization(
  receipt: CatalogSyncFailureReceipt | undefined,
  { container }: StepExecutionContext,
): Promise<void> {
  if (!receipt?.syncRecordId) {
    return;
  }
  const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  await recordFailure(
    container,
    catalogSync,
    receipt.syncRecordId,
    catalogError(
      "catalog_import_failed",
      "The Catalog synchronization failed before it completed.",
    ),
  );
  try {
    await demoteFailedCatalogProduct(
      container,
      catalogSync,
      receipt.syncRecordId,
      receipt.lockOwnerId,
    );
  } catch (thrown) {
    const error =
      thrown instanceof Error ? thrown : new Error("The failure projection returned no Error.");
    logFailureRecoveryError(container, receipt.syncRecordId, error);
  } finally {
    await releaseFailedCatalogLocks(container, receipt);
  }
}

async function prepareStartedCatalogSynchronization(
  begun: BegunCatalogSynchronization,
  { container }: StepExecutionContext,
): Promise<StepResponse<PreparedCatalogImport>> {
  if (begun.tag !== "started") {
    throw new Error("A replayed Catalog synchronization cannot read Odoo again.");
  }
  const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  try {
    const batch = await catalogSync.readNextCatalogItem({ cursor: begun.cursor });
    const prepared = prepareCatalogSynchronization(begun.syncRecordId, batch);
    await catalogSync.recordSyncSource(begun.syncRecordId, toImportSource(prepared));
    validateCatalogItem(prepared.item);
    return new StepResponse(prepared);
  } catch (thrown) {
    const decoded = SerializedWorkflowErrorSchema.safeParse(thrown);
    const error =
      thrown instanceof Error
        ? thrown
        : decoded.success
          ? serializedWorkflowErrorToError(decoded.data)
          : new Error("The Catalog synchronization threw a value that was not an Error.");
    await recordFailure(container, catalogSync, begun.syncRecordId, error);
    throw error;
  }
}

async function planCatalogSynchronization(
  prepared: PreparedCatalogImport,
  { container }: StepExecutionContext,
): Promise<StepResponse<CatalogSynchronizationPlan>> {
  const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  try {
    const identities = [
      toIdentity(prepared.item.template),
      ...prepared.item.variants.map(toIdentity),
    ];
    const existing = await catalogSync.findCatalogProjection({
      templateIntegrationKey: prepared.item.template.integrationKey,
      templateDatabaseId: prepared.item.template.id,
    });
    if (!existing) {
      await catalogSync.assertCatalogIdentities(identities);
      return new StepResponse({ tag: "create", prepared });
    }

    await catalogSync.assertCatalogIdentities(identities, {
      allowedMappingIds: existing.mappings.map(({ id }) => id),
    });
    validateExistingProjection(prepared.item, existing);
    if (
      existing.template.source_fingerprint === prepared.sourceFingerprint &&
      catalogSourceSnapshotMatches(prepared.item, existing)
    ) {
      return new StepResponse({
        tag: "unchanged",
        prepared,
        existing,
        result: unchangedCatalogSynchronization(prepared, existing),
      });
    }

    const product = await fetchCurrentCatalogProduct(
      container,
      existing.template.medusa_product_id,
    );
    return new StepResponse({
      tag: "update",
      prepared: { ...prepared, existing, product },
    });
  } catch (thrown) {
    const decoded = SerializedWorkflowErrorSchema.safeParse(thrown);
    const error =
      thrown instanceof Error
        ? thrown
        : decoded.success
          ? serializedWorkflowErrorToError(decoded.data)
          : new Error("The Catalog synchronization threw a value that was not an Error.");
    await recordFailure(container, catalogSync, prepared.syncRecordId, error);
    throw error;
  }
}

async function touchUnchangedCatalogProjection(
  plan: CatalogSynchronizationPlan,
  { container }: StepExecutionContext,
): Promise<StepResponse<CatalogSynchronizationResult, CatalogProjectionReceipt>> {
  if (plan.tag !== "unchanged") {
    throw new Error("Only an unchanged Catalog plan can touch its projection.");
  }
  const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  try {
    const commit = await catalogSync.commitProjection({
      tag: "touch",
      syncRecordId: plan.prepared.syncRecordId,
      mappingIds: plan.existing.mappings.map(({ id }) => id),
      attributeIds: plan.existing.attributes.map(({ id }) => id),
      valueIds: plan.existing.values.map(({ id }) => id),
      selectionIds: plan.existing.selections.map(({ id }) => id),
    });
    return new StepResponse(plan.result, commit.receipt);
  } catch (thrown) {
    throw await recordCatalogStepFailure(
      container,
      plan.prepared.syncRecordId,
      thrown instanceof Error
        ? thrown
        : new Error("The Catalog projection step threw a value that was not an Error."),
    );
  }
}

async function revertTouchedCatalogProjection(
  receipt: CatalogProjectionReceipt | undefined,
  { container }: StepExecutionContext,
): Promise<void> {
  if (!receipt) {
    return;
  }
  const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  await catalogSync.revertProjection(receipt);
}

function selectCatalogSynchronizationResult(
  input: SelectCatalogSynchronizationResultInput,
): StepResponse<SynchronizeCatalogItemResult> {
  if (input.begun.tag === "replayed") {
    return new StepResponse({ ...input.begun.result, disposition: "replayed" });
  }
  if (input.created) {
    return new StepResponse({ ...input.created, disposition: "created" });
  }
  if (input.updated) {
    return new StepResponse({ ...input.updated, disposition: "updated" });
  }
  if (input.unchanged) {
    return new StepResponse({ ...input.unchanged, disposition: "unchanged" });
  }

  throw catalogError(
    "catalog_projection_result_invalid",
    "The Catalog synchronization produced no branch result.",
  );
}

async function projectCatalogAvailability(
  { productId, syncRecordId }: RefreshCatalogAvailabilityInput,
  { container }: StepExecutionContext,
): Promise<
  StepResponse<RefreshCatalogAvailabilityResult, readonly CatalogStorefrontAvailabilitySnapshot[]>
> {
  const authoring = container.resolve<ProductAuthoringModuleService>(PRODUCT_AUTHORING_MODULE);
  const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  try {
    const record = await authoring.getAuthoring(productId);
    const projection = await catalogSync.projectAvailability(
      productId,
      record?.state === "published",
      { resolvingSyncRecordId: syncRecordId },
    );
    return new StepResponse(
      { productId, productAvailable: projection.productAvailable },
      projection.previous,
    );
  } catch (thrown) {
    throw await recordCatalogStepFailure(
      container,
      syncRecordId,
      thrown instanceof Error
        ? thrown
        : new Error("The availability step threw a value that was not an Error."),
    );
  }
}

async function restoreCatalogAvailability(
  previous: readonly CatalogStorefrontAvailabilitySnapshot[] | undefined,
  { container }: StepExecutionContext,
): Promise<void> {
  if (!previous) {
    return;
  }
  const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  await catalogSync.restoreAvailability(previous);
}

const projectCatalogAvailabilityStep = createStep(
  "project-synchronized-catalog-availability",
  projectCatalogAvailability,
  restoreCatalogAvailability,
);

const refreshCatalogAvailabilityWorkflow = createWorkflow<
  RefreshCatalogAvailabilityInput,
  string,
  []
>("refresh-catalog-availability", function (input) {
  const projection = projectCatalogAvailabilityStep(input);
  const update = transform(projection, ({ productId, productAvailable }) => ({
    products: [
      {
        id: productId,
        status: productAvailable ? ProductStatus.PUBLISHED : ProductStatus.DRAFT,
      },
    ],
  }));
  const products = updateProductsWorkflow.runAsStep({ input: update });
  return new WorkflowResponse(
    transform({ products, projection }, ({ projection }) => projection.productId),
  );
});

async function finishSucceededCatalogSynchronization(
  {
    prepared,
    result,
  }: Readonly<{
    prepared: PreparedCatalogImport;
    result: SynchronizeCatalogItemResult;
    refreshed: string;
  }>,
  { container }: StepExecutionContext,
): Promise<StepResponse<SynchronizeCatalogItemResult>> {
  const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  await catalogSync.finishSync(prepared.syncRecordId, {
    tag: "succeeded",
    sourceFingerprint: prepared.sourceFingerprint,
    result,
  });
  return new StepResponse(result);
}

async function releaseCatalogLocks(
  {
    ownerId,
  }: Readonly<{
    ownerId: string;
    result: SynchronizeCatalogItemResult;
    finished?: SynchronizeCatalogItemResult;
  }>,
  { container }: StepExecutionContext,
): Promise<StepResponse<string>> {
  const locking = container.resolve<ILockingModule>(Modules.LOCKING);
  try {
    await locking.releaseAll({ ownerId });
    return new StepResponse(ownerId);
  } catch (thrown) {
    const message =
      thrown instanceof Error ? thrown.message : "The lock provider returned no Error.";
    throw catalogError(
      "catalog_lock_release_failed",
      `Could not release Catalog synchronization locks: ${message}`,
    );
  }
}

function createCatalogLockOwner(input: SynchronizeCatalogItemInput): StepResponse<string> {
  return new StepResponse(`${input.operationId}:${randomUUID()}`);
}

const beginCatalogSynchronizationStep = createStep<
  BeginCatalogSynchronizationInput,
  BegunCatalogSynchronization,
  CatalogSyncFailureReceipt
>("begin-catalog-synchronization", beginCatalogSynchronization, compensateCatalogSynchronization);

const prepareStartedCatalogSynchronizationStep = createStep(
  "prepare-started-catalog-synchronization",
  prepareStartedCatalogSynchronization,
);

const planCatalogSynchronizationStep = createStep(
  "plan-catalog-synchronization",
  planCatalogSynchronization,
);

const touchUnchangedCatalogProjectionStep = createStep(
  "touch-unchanged-catalog-projection",
  touchUnchangedCatalogProjection,
  revertTouchedCatalogProjection,
);

const selectCatalogSynchronizationResultStep = createStep(
  "select-catalog-synchronization-result",
  async (input: SelectCatalogSynchronizationResultInput, { container }) => {
    try {
      return selectCatalogSynchronizationResult(input);
    } catch (thrown) {
      if (input.begun.tag === "started") {
        throw await recordCatalogStepFailure(
          container,
          input.begun.syncRecordId,
          thrown instanceof Error
            ? thrown
            : new Error("The Catalog result step threw a value that was not an Error."),
        );
      }
      throw thrown;
    }
  },
);

const finishSucceededCatalogSynchronizationStep = createStep(
  "finish-succeeded-catalog-synchronization",
  finishSucceededCatalogSynchronization,
);

const releaseCatalogLocksStep = createStep(
  "release-catalog-synchronization-locks",
  releaseCatalogLocks,
);

const createCatalogLockOwnerStep = createStep(
  "create-catalog-synchronization-lock-owner",
  createCatalogLockOwner,
);

export const synchronizeCatalogItemWorkflow = createWorkflow<
  SynchronizeCatalogItemInput,
  SynchronizeCatalogItemResult,
  []
>("synchronize-catalog-item", function (input) {
  const lockOwnerId = createCatalogLockOwnerStep(input);
  const operationLock = transform(
    { input, lockOwnerId },
    ({ input: { operationId }, lockOwnerId }) => ({
      key: `catalog-import:${operationId}`,
      ownerId: lockOwnerId,
      timeout: 30,
      ttl: 120,
      executeOnSubWorkflow: true,
    }),
  );
  const acquiredOperationLock = acquireLockStep(operationLock).config({
    name: "acquire-catalog-operation-lock",
  });
  const begun = beginCatalogSynchronizationStep(
    transform({ input, lockOwnerId, acquiredOperationLock }, ({ input, lockOwnerId }) => ({
      request: input,
      lockOwnerId,
    })),
  );
  const prepared = when(
    "prepare-new-catalog-synchronization",
    { begun },
    ({ begun }) => begun.tag === "started",
  ).then(() => prepareStartedCatalogSynchronizationStep(begun));

  const productLock = when("lock-catalog-product", { prepared }, ({ prepared }) =>
    Boolean(prepared),
  ).then(() => {
    const lock = transform({ lockOwnerId, prepared }, ({ lockOwnerId, prepared }) => {
      if (!prepared) {
        throw new Error("The Catalog Product lock needs a prepared synchronization.");
      }
      return {
        key: `catalog-product:${prepared.item.template.integrationKey}`,
        ownerId: lockOwnerId,
        timeout: 30,
        ttl: 120,
        executeOnSubWorkflow: true,
      };
    });
    return acquireLockStep(lock).config({ name: "acquire-catalog-product-lock" });
  });

  const plan = when("plan-new-catalog-synchronization", { prepared }, ({ prepared }) =>
    Boolean(prepared),
  ).then(() => {
    const planInput = transform({ prepared, productLock }, ({ prepared }) => {
      if (!prepared) {
        throw new Error("The Catalog planner needs a prepared synchronization.");
      }
      return prepared;
    });
    return planCatalogSynchronizationStep(planInput);
  });

  const created = when(
    "create-catalog-product",
    { plan },
    ({ plan }) => plan?.tag === "create",
  ).then(() => {
    const createInput = transform({ plan }, ({ plan }) => {
      if (plan?.tag !== "create") {
        throw new Error("The Catalog create branch received another plan.");
      }
      return plan.prepared;
    });
    return createCatalogProductWorkflow.runAsStep({ input: createInput });
  });

  const updated = when(
    "update-catalog-product",
    { plan },
    ({ plan }) => plan?.tag === "update",
  ).then(() => {
    const updateInput = transform({ plan }, ({ plan }) => {
      if (plan?.tag !== "update") {
        throw new Error("The Catalog update branch received another plan.");
      }
      return plan.prepared;
    });
    return updateCatalogProductWorkflow.runAsStep({ input: updateInput });
  });

  const unchanged = when(
    "touch-unchanged-catalog-product",
    { plan },
    ({ plan }) => plan?.tag === "unchanged",
  ).then(() => {
    const unchangedPlan = transform({ plan }, ({ plan }) => {
      if (!plan) {
        throw new Error("The unchanged Catalog branch needs a plan.");
      }
      return plan;
    });
    return touchUnchangedCatalogProjectionStep(unchangedPlan);
  });

  const result = selectCatalogSynchronizationResultStep({
    begun,
    created,
    updated,
    unchanged,
  });

  const authoringLock = when(
    "lock-catalog-authoring-product",
    { begun },
    ({ begun }) => begun.tag === "started",
  ).then(() => {
    const lock = transform({ lockOwnerId, result }, ({ lockOwnerId, result }) => ({
      key: `product-authoring:${result.productId}`,
      ownerId: lockOwnerId,
      timeout: 30,
      ttl: 120,
      executeOnSubWorkflow: true,
    }));
    return acquireLockStep(lock).config({ name: "acquire-catalog-authoring-lock" });
  });

  const refreshed = when(
    "refresh-new-catalog-availability",
    { begun },
    ({ begun }) => begun.tag === "started",
  ).then(() => {
    const refreshInput = transform({ result, authoringLock }, ({ result }) => ({
      productId: result.productId,
      syncRecordId: result.syncRecordId,
    }));
    return refreshCatalogAvailabilityWorkflow.runAsStep({ input: refreshInput });
  });

  const finished = when(
    "finish-new-catalog-synchronization",
    { begun },
    ({ begun }) => begun.tag === "started",
  ).then(() => {
    const finishInput = transform(
      { prepared, result, refreshed },
      ({ prepared, result, refreshed }) => {
        if (!prepared || !refreshed) {
          throw new Error("A started Catalog synchronization needs projection before completion.");
        }
        return { prepared, result, refreshed };
      },
    );
    return finishSucceededCatalogSynchronizationStep(finishInput);
  });

  const locks = transform(
    { lockOwnerId, result, finished },
    ({ lockOwnerId, result, finished }) => ({
      ownerId: lockOwnerId,
      result,
      finished,
    }),
  );
  const released = releaseCatalogLocksStep(locks);

  return new WorkflowResponse(
    transform({ result, released }, ({ result, released }) => {
      void released;
      return result;
    }),
  );
});

function toIdentity(source: CatalogTemplate | CatalogVariant): CatalogIdentity {
  return source.model === "product.template"
    ? {
        odooModel: source.model,
        odooDatabaseId: source.id,
        odooIntegrationKey: source.integrationKey,
      }
    : {
        odooModel: source.model,
        odooDatabaseId: source.id,
        odooIntegrationKey: source.integrationKey,
      };
}

function validateExistingProjection(item: CatalogItem, existing: CatalogProjectionRecords): void {
  if (
    Date.parse(existing.template.source_revision_changed_at) >
    Date.parse(item.sourceRevision.changedAt)
  ) {
    throw structureConflict("An older Source Revision cannot replace the mapped Catalog state.");
  }

  const incomingVariantKeys = new Set<string>(
    item.variants.map(({ integrationKey }) => integrationKey),
  );
  const missingVariant = existing.mappings.find(
    (mapping) =>
      mapping.odoo_model === "product.product" &&
      !incomingVariantKeys.has(mapping.odoo_integration_key),
  );
  if (missingVariant) {
    throw catalogError(
      "catalog_source_missing_variant",
      `Odoo omitted mapped Variant ${missingVariant.odoo_database_id} from a complete Catalog Item.`,
    );
  }

  if (existing.attributes.length !== item.template.attributes.length) {
    throw structureConflict("The Odoo Product attribute set changed after initial intake.");
  }
  for (const sourceAttribute of item.template.attributes) {
    const mapping = existing.attributes.find(
      ({ odoo_attribute_id }) => odoo_attribute_id === sourceAttribute.id,
    );
    if (!mapping || mapping.variant_creation_mode !== sourceAttribute.variantCreationMode) {
      throw structureConflict(
        `Odoo attribute ${sourceAttribute.id} changed identity or Variant creation mode.`,
      );
    }

    const mappedValues = existing.values.filter(
      ({ catalog_attribute_mapping_id }) => catalog_attribute_mapping_id === mapping.id,
    );
    for (const valueMapping of mappedValues) {
      const sourceValue = sourceAttribute.values.find(
        ({ id }) => id === valueMapping.odoo_attribute_value_id,
      );
      if (
        !sourceValue ||
        valueMapping.odoo_template_attribute_value_id !== sourceValue.templateValueId
      ) {
        throw structureConflict(
          `Odoo attribute value ${sourceAttribute.id}:${valueMapping.odoo_attribute_value_id} changed identity or disappeared.`,
        );
      }
    }
  }

  const attributeByMappingId = new Map(
    existing.attributes.map((attribute) => [attribute.id, attribute]),
  );
  const valueByMappingId = new Map(existing.values.map((value) => [value.id, value]));
  for (const variant of item.variants) {
    const mapping = existing.mappings.find(
      ({ odoo_integration_key }) => odoo_integration_key === variant.integrationKey,
    );
    if (!mapping) {
      continue;
    }

    const storedCombination = existing.selections
      .filter(({ variant_catalog_mapping_id }) => variant_catalog_mapping_id === mapping.id)
      .map((selection) => {
        const attribute = attributeByMappingId.get(selection.catalog_attribute_mapping_id);
        const value = valueByMappingId.get(selection.catalog_attribute_value_mapping_id);
        if (!attribute || !value) {
          throw structureConflict("A stored Catalog Variant selection has broken identity links.");
        }
        return `${attribute.odoo_attribute_id}:${value.odoo_attribute_value_id}`;
      })
      .sort();
    const sourceCombination = variant.attributeValues
      .map(({ attributeId, valueId }) => `${attributeId}:${valueId}`)
      .sort();
    if (stringify(storedCombination) !== stringify(sourceCombination)) {
      throw structureConflict(
        `Odoo Variant ${variant.id} changed its stable attribute combination.`,
      );
    }
  }
}

function catalogSourceSnapshotMatches(
  item: CatalogItem,
  existing: CatalogProjectionRecords,
): boolean {
  if (
    existing.template.source_label !== item.template.name ||
    existing.template.source_available !== !isCatalogTemplateUnavailable(item.template)
  ) {
    return false;
  }

  const variantMappingByKey = new Map(
    existing.mappings
      .filter(({ odoo_model }) => odoo_model === "product.product")
      .map((mapping) => [mapping.odoo_integration_key, mapping]),
  );
  for (const variant of item.variants) {
    const mapping = variantMappingByKey.get(variant.integrationKey);
    if (
      !mapping ||
      mapping.source_label !== variant.name ||
      mapping.source_internal_reference !== variant.internalReference ||
      mapping.source_barcode !== variant.barcode ||
      mapping.source_available !== !isCatalogVariantUnavailable(item, variant)
    ) {
      return false;
    }
  }

  for (const attribute of item.template.attributes) {
    const mapping = existing.attributes.find(
      ({ odoo_attribute_id }) => odoo_attribute_id === attribute.id,
    );
    if (!mapping || mapping.source_label !== attribute.name) {
      return false;
    }
    for (const value of attribute.values) {
      const valueMapping = existing.values.find(
        (candidate) =>
          candidate.catalog_attribute_mapping_id === mapping.id &&
          candidate.odoo_attribute_value_id === value.id,
      );
      if (!valueMapping || valueMapping.source_label !== value.name) {
        return false;
      }
    }
  }

  return true;
}

function unchangedCatalogSynchronization(
  prepared: PreparedCatalogImport,
  existing: CatalogProjectionRecords,
): CatalogSynchronizationResult {
  const variantMappingByKey = new Map(
    existing.mappings
      .filter(({ odoo_model }) => odoo_model === "product.product")
      .map((mapping) => [mapping.odoo_integration_key, mapping]),
  );
  const variants = prepared.item.variants.map((variant) => {
    const mapping = variantMappingByKey.get(variant.integrationKey);
    if (!mapping?.medusa_variant_id) {
      throw catalogError(
        "catalog_projection_result_invalid",
        `Mapped Odoo Variant ${variant.id} has no Medusa Variant identity.`,
      );
    }

    return {
      integrationKey: variant.integrationKey,
      odooVariantId: variant.id,
      medusaVariantId: mapping.medusa_variant_id,
      catalogMappingId: mapping.id,
      disposition: "unchanged" as const,
      sourceAvailable: mapping.source_available,
      approvalState: mapping.approval_state,
    };
  });

  return {
    syncRecordId: prepared.syncRecordId,
    productId: existing.template.medusa_product_id,
    templateCatalogMappingId: existing.template.id,
    templateIntegrationKey: prepared.item.template.integrationKey,
    variants,
    sourceRevision: prepared.item.sourceRevision,
    nextCursor: prepared.nextCursor,
  };
}

async function fetchCurrentCatalogProduct(
  container: MedusaContainer,
  productId: string,
): Promise<CurrentCatalogProduct> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY);
  const { data } = await query.graph({
    entity: "product",
    fields: [
      "id",
      "status",
      "options.id",
      "options.title",
      "options.values.id",
      "options.values.value",
    ],
    filters: { id: productId },
  });
  const decoded = CurrentCatalogProductSchema.array().safeParse(data);
  const product = decoded.success ? decoded.data[0] : undefined;
  if (!product) {
    throw catalogError(
      "catalog_projection_result_invalid",
      `Mapped Product ${productId} could not be loaded.`,
    );
  }

  return product satisfies CurrentCatalogProduct;
}

function prepareCatalogSynchronization(
  syncRecordId: string,
  batch: CatalogBatch,
): PreparedCatalogImport {
  if (batch.items.length === 0) {
    throw catalogError("catalog_source_empty", "Odoo returned no Catalog Item for this cursor.");
  }
  if (batch.items.length !== 1) {
    throw sourceRejected("Odoo returned more than one Catalog Item for a limit of one.");
  }

  const item = batch.items[0]!;
  return {
    syncRecordId,
    item,
    currencyCode: batch.priceList.currency.toLowerCase(),
    sourceFingerprint: fingerprint({
      contractVersion: batch.contractVersion,
      item,
      priceList: batch.priceList,
    }),
    nextCursor: batch.nextCursor,
  };
}

function validateCatalogItem(item: CatalogItem): void {
  const { template } = item;
  if (item.sourceRevision.productId !== template.id) {
    throw sourceRejected("The Source Revision does not identify its Odoo Product template.");
  }

  const integrationKeys = [
    template.integrationKey,
    ...item.variants.map(({ integrationKey }) => integrationKey),
  ];
  if (new Set(integrationKeys).size !== integrationKeys.length) {
    throw sourceRejected(
      "The Odoo Product template and Variants must have distinct Integration Keys.",
    );
  }

  validateAttributes(template.attributes);
  const projectedAttributes = template.attributes.filter(
    ({ variantCreationMode }) => variantCreationMode !== "never",
  );
  if (!projectedAttributes.length && item.variants.length !== 1) {
    throw structureConflict(
      "An Odoo Product without Variant-producing attributes must have exactly one Variant.",
    );
  }

  const variantIds = item.variants.map(({ id }) => id);
  if (new Set(variantIds).size !== variantIds.length) {
    throw sourceRejected("Odoo Variant database IDs must be distinct within one Catalog Item.");
  }

  const attributeById = new Map(template.attributes.map((attribute) => [attribute.id, attribute]));
  const combinations = new Set<string>();
  for (const variant of item.variants) {
    const selections = new Map<number, number>();
    for (const { attributeId, valueId } of variant.attributeValues) {
      const attribute = attributeById.get(attributeId);
      if (!attribute || !attribute.values.some(({ id }) => id === valueId)) {
        throw structureConflict(
          `Odoo Variant ${variant.id} references unknown attribute value ${attributeId}:${valueId}.`,
        );
      }
      if (selections.has(attributeId)) {
        throw structureConflict(
          `Odoo Variant ${variant.id} has more than one value for attribute ${attributeId}.`,
        );
      }
      selections.set(attributeId, valueId);
    }

    const combination = projectedAttributes.map((attribute) => {
      const valueId = selections.get(attribute.id);
      if (!valueId) {
        throw structureConflict(
          `Odoo Variant ${variant.id} is missing projected attribute ${attribute.id}.`,
        );
      }
      return `${attribute.id}:${valueId}`;
    });
    const combinationKey = combination.join("|");
    if (combinations.has(combinationKey)) {
      throw structureConflict("Two Odoo Variants have the same projected attribute combination.");
    }
    combinations.add(combinationKey);

    const price = Number(variant.price);
    if (!Number.isFinite(price) || price < 0) {
      throw sourceRejected("Each Odoo Variant price must be a finite non-negative amount.");
    }
  }
}

function validateAttributes(attributes: readonly CatalogAttribute[]): void {
  const attributeIds = attributes.map(({ id }) => id);
  if (new Set(attributeIds).size !== attributeIds.length) {
    throw structureConflict("Odoo attribute IDs must be distinct within one Product template.");
  }

  const projectedLabels = attributes
    .filter(({ variantCreationMode }) => variantCreationMode !== "never")
    .map(({ name }) => name);
  if (new Set(projectedLabels).size !== projectedLabels.length) {
    throw structureConflict("Projected Odoo attribute labels must be distinct.");
  }

  const templateValueIds = new Set<number>();
  for (const attribute of attributes) {
    const valueIds = attribute.values.map(({ id }) => id);
    const valueLabels = attribute.values.map(({ name }) => name);
    if (new Set(valueIds).size !== valueIds.length) {
      throw structureConflict(`Odoo attribute ${attribute.id} contains a duplicate value ID.`);
    }
    if (
      attribute.variantCreationMode !== "never" &&
      new Set(valueLabels).size !== valueLabels.length
    ) {
      throw structureConflict(`Odoo attribute ${attribute.id} contains a duplicate value label.`);
    }
    for (const value of attribute.values) {
      if (templateValueIds.has(value.templateValueId)) {
        throw structureConflict("Odoo template attribute value IDs must be distinct.");
      }
      templateValueIds.add(value.templateValueId);
    }
  }
}

function toImportSource(prepared: PreparedCatalogImport) {
  return {
    templateIntegrationKey: prepared.item.template.integrationKey,
    sourceFingerprint: prepared.sourceFingerprint,
    sourceRevision: prepared.item.sourceRevision,
    nextCursor: prepared.nextCursor,
  };
}

async function recordFailure(
  container: MedusaContainer,
  catalogSync: CatalogSyncModule,
  syncRecordId: string,
  error: Error,
): Promise<void> {
  try {
    await catalogSync.failSyncIfActive(
      syncRecordId,
      MedusaError.isMedusaError(error)
        ? { type: error.type, code: error.code ?? null, message: error.message }
        : {
            type: MedusaError.Types.UNEXPECTED_STATE,
            code: "catalog_import_failed",
            message: "The Catalog synchronization failed because of an internal error.",
          },
    );
  } catch (recordError) {
    const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
    const message =
      recordError instanceof Error
        ? recordError.message
        : "The failure recorder threw a value that was not an Error.";
    logger.error(`Could not record failure for Catalog Sync Record ${syncRecordId}: ${message}`);
  }
}

async function releaseFailedCatalogLocks(
  container: MedusaContainer,
  receipt: CatalogSyncFailureReceipt,
): Promise<void> {
  try {
    const locking = container.resolve<ILockingModule>(Modules.LOCKING);
    await locking.releaseAll({ ownerId: receipt.lockOwnerId });
  } catch (thrown) {
    const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
    const message =
      thrown instanceof Error ? thrown.message : "The lock provider returned no Error.";
    logger.error(`Could not release failed Catalog synchronization locks: ${message}`);
  }
}

async function demoteFailedCatalogProduct(
  container: MedusaContainer,
  catalogSync: CatalogSyncModule,
  syncRecordId: string,
  lockOwnerId: string,
): Promise<void> {
  const productId = await catalogSync.getSyncProductId(syncRecordId);
  if (!productId) {
    return;
  }

  const locking = container.resolve<ILockingModule>(Modules.LOCKING);
  const authoringLock = `product-authoring:${productId}`;
  await locking.release(authoringLock, { ownerId: lockOwnerId });
  await locking.execute(
    authoringLock,
    async () => {
      if (!(await catalogSync.shouldProjectSyncFailure(syncRecordId, productId))) {
        return;
      }
      await catalogSync.projectAvailability(productId, false);
      const productModule = container.resolve<IProductModuleService>(Modules.PRODUCT);
      await productModule.updateProducts(productId, { status: ProductStatus.DRAFT });
    },
    { timeout: 30 },
  );
}

function logFailureRecoveryError(
  container: MedusaContainer,
  syncRecordId: string,
  error: Error,
): void {
  const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
  logger.error(
    `Could not project failure for Catalog Sync Record ${syncRecordId}: ${error.message}`,
  );
}

function serializedWorkflowErrorToError(
  value: z.infer<typeof SerializedWorkflowErrorSchema>,
): Error {
  if (!value.type) {
    return new Error(value.message);
  }

  return new MedusaError(value.type, value.message, value.code);
}

function sourceRejected(message: string): MedusaError {
  return catalogError("catalog_source_rejected", message);
}

function structureConflict(message: string): MedusaError {
  return catalogError("catalog_structure_conflict", message);
}

function fingerprint(value: CatalogFingerprintInput): string {
  return createHash("sha256").update(stringify(value)).digest("hex");
}
