import type { ILockingModule, Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import type {
  CatalogAttribute,
  CatalogBatch,
  CatalogItem,
  OdooBridgeError,
} from "@mze-store/odoo-bridge";
import stringify from "fast-json-stable-stringify";
import { createHash } from "node:crypto";
import { CATALOG_SYNC_MODULE } from "~/modules/catalog-sync";
import { CatalogSynchronizationResultSchema } from "~/modules/catalog-sync/schema";
import type {
  CatalogProjectionRecords,
  CatalogSyncModule,
  SyncRecordRecord,
} from "~/modules/catalog-sync/service";
import type { CatalogCursor, CatalogSynchronizationResult } from "~/modules/catalog-sync/types";
import {
  createCatalogProductWorkflow,
  type PreparedCatalogImport,
} from "~/workflows/catalog-product-import";
import {
  updateCatalogProductWorkflow,
  type CurrentCatalogProduct,
} from "~/workflows/catalog-product-update";
import { isCatalogTemplateUnavailable, isCatalogVariantUnavailable } from "./catalog-projection";

export type SynchronizeCatalogItemInput = Readonly<{
  operationId: string;
  cursor?: CatalogCursor | null;
  signal?: AbortSignal;
}>;

export type SynchronizeCatalogItemResult = CatalogSynchronizationResult &
  Readonly<{ disposition: "created" | "updated" | "unchanged" | "replayed" }>;

type CatalogFingerprintInput =
  | Readonly<{
      operation: "catalog.synchronize";
      cursor: CatalogCursor | null;
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

export async function synchronizeCatalogItem(
  container: MedusaContainer,
  input: SynchronizeCatalogItemInput,
): Promise<SynchronizeCatalogItemResult> {
  const requestFingerprint = fingerprint({
    operation: "catalog.synchronize",
    cursor: input.cursor ?? null,
  });
  const locking = container.resolve<ILockingModule>(Modules.LOCKING);

  return locking.execute(
    `catalog-import:${input.operationId}`,
    async () => {
      const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
      const begun = await catalogSync.beginImport({
        operationId: input.operationId,
        requestFingerprint,
      });

      if (!begun.created) {
        return replayCatalogSynchronization(begun.record);
      }

      const inProgress = await catalogSync.markImportInProgress(begun.record);
      try {
        const batchResult = await catalogSync.readCatalogBatch({
          cursor: input.cursor ?? null,
          limit: 1,
          signal: input.signal,
        });

        if (batchResult._tag === "Failure") {
          throw bridgeFailureError(batchResult.failure);
        }

        const prepared = prepareCatalogSynchronization(inProgress.id, batchResult.success);
        await catalogSync.recordImportSource(inProgress.id, toImportSource(prepared));

        return await locking.execute(
          `catalog-product:${prepared.item.template.integrationKey}`,
          async () => {
            const identities = [
              {
                odooModel: prepared.item.template.model,
                odooIntegrationKey: prepared.item.template.integrationKey,
                odooDatabaseId: prepared.item.template.id,
              },
              ...prepared.item.variants.map((variant) => ({
                odooModel: variant.model,
                odooIntegrationKey: variant.integrationKey,
                odooDatabaseId: variant.id,
              })),
            ] as const;
            const existing = await catalogSync.findCatalogProjection({
              templateIntegrationKey: prepared.item.template.integrationKey,
              templateDatabaseId: prepared.item.template.id,
            });
            if (existing) {
              await catalogSync.assertCatalogIdentitiesCompatible(
                identities,
                existing.mappings.map(({ id }) => id),
              );
              validateExistingProjection(prepared.item, existing);
              if (
                existing.template.source_fingerprint === prepared.sourceFingerprint &&
                catalogSourceSnapshotMatches(prepared.item, existing)
              ) {
                const result = unchangedCatalogSynchronization(prepared, existing);
                await catalogSync.completeUnchangedImport({
                  ...toImportSource(prepared),
                  syncRecordId: prepared.syncRecordId,
                  result,
                  projection: {
                    mappingIds: existing.mappings.map(({ id }) => id),
                    attributeIds: existing.attributes.map(({ id }) => id),
                    valueIds: existing.values.map(({ id }) => id),
                    selectionIds: existing.selections.map(({ id }) => id),
                  },
                });

                return { ...result, disposition: "unchanged" };
              }
              const product = await fetchCurrentCatalogProduct(
                container,
                existing.template.medusa_product_id,
              );
              const { result } = await updateCatalogProductWorkflow(container).run({
                input: { ...prepared, existing, product },
                context: { transactionId: input.operationId },
              });

              return { ...result, disposition: "updated" };
            }

            await catalogSync.assertCatalogIdentitiesAvailable(identities);
            const { result } = await createCatalogProductWorkflow(container).run({
              input: prepared,
              context: { transactionId: input.operationId },
            });

            return { ...result, disposition: "created" };
          },
          { timeout: 30 },
        );
      } catch (thrown) {
        const serializedError = SerializedWorkflowErrorSchema.safeParse(thrown);
        const error =
          thrown instanceof Error
            ? thrown
            : serializedError.success
              ? serializedError.data.type
                ? new MedusaError(
                    serializedError.data.type,
                    serializedError.data.message,
                    serializedError.data.code,
                  )
                : new Error(serializedError.data.message)
              : new Error("The Catalog synchronization threw a value that was not an Error.");
        await recordFailure(container, catalogSync, inProgress.id, error);
        throw error;
      }
    },
    { timeout: 30 },
  );
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
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      `Odoo omitted mapped Variant ${missingVariant.odoo_database_id} from a complete Catalog Item.`,
      "catalog_source_missing_variant",
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
    existing.template.archived !== isCatalogTemplateUnavailable(item.template)
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
      mapping.archived !== isCatalogVariantUnavailable(item, variant)
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
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Mapped Odoo Variant ${variant.id} has no Medusa Variant identity.`,
        "catalog_projection_result_invalid",
      );
    }

    return {
      integrationKey: variant.integrationKey,
      odooVariantId: variant.id,
      medusaVariantId: mapping.medusa_variant_id,
      catalogMappingId: mapping.id,
      disposition: "unchanged" as const,
      availability: mapping.archived ? ("unavailable" as const) : ("available" as const),
    };
  });

  return {
    syncRecordId: prepared.syncRecordId,
    productId: existing.template.medusa_product_id,
    templateCatalogMappingId: existing.template.id,
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
    fields: ["id", "options.id", "options.title", "options.values.id", "options.values.value"],
    filters: { id: productId },
  });
  const [product] = data as CurrentCatalogProduct[];
  if (!product) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Mapped Product ${productId} could not be loaded.`,
      "catalog_projection_result_invalid",
    );
  }

  return product;
}

function prepareCatalogSynchronization(
  syncRecordId: string,
  batch: CatalogBatch,
): PreparedCatalogImport {
  if (batch.items.length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Odoo returned no Catalog Item for this cursor.",
      "catalog_source_empty",
    );
  }
  if (batch.items.length !== 1) {
    throw sourceRejected("Odoo returned more than one Catalog Item for a limit of one.");
  }

  const item = batch.items[0]!;
  validateCatalogItem(item);

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

function replayCatalogSynchronization(record: SyncRecordRecord): SynchronizeCatalogItemResult {
  if (record.state === "failed" || record.state === "dead_letter") {
    throw recordedFailure(record);
  }
  if (record.state !== "succeeded") {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      `Catalog synchronization operation ${record.operation_id} is already ${record.state}.`,
      "catalog_operation_in_progress",
    );
  }

  const decoded = CatalogSynchronizationResultSchema.safeParse(record.result);
  if (!decoded.success) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Catalog synchronization operation ${record.operation_id} has an invalid stored result.`,
      "catalog_result_invalid",
    );
  }

  return { ...decoded.data, disposition: "replayed" };
}

function bridgeFailureError(error: OdooBridgeError): MedusaError {
  switch (error._tag) {
    case "OdooBridgeCallAborted":
      return new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The Catalog synchronization was cancelled during the Odoo read.",
        "catalog_import_cancelled",
      );
    case "AmbiguousCatalogIdentity":
    case "InvalidCatalogBatchInput":
    case "InvalidCatalogBatchResponse":
      return sourceRejected(error.message);
    default:
      return new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "The Odoo Catalog source is unavailable.",
        "catalog_source_unavailable",
      );
  }
}

function sourceRejected(message: string): MedusaError {
  return new MedusaError(MedusaError.Types.INVALID_DATA, message, "catalog_source_rejected");
}

function structureConflict(message: string): MedusaError {
  return new MedusaError(MedusaError.Types.CONFLICT, message, "catalog_structure_conflict");
}

async function recordFailure(
  container: MedusaContainer,
  catalogSync: CatalogSyncModule,
  syncRecordId: string,
  error: Error,
): Promise<void> {
  const failure = MedusaError.isMedusaError(error)
    ? { type: error.type, code: error.code ?? null, message: error.message }
    : {
        type: MedusaError.Types.UNEXPECTED_STATE,
        code: "catalog_import_failed",
        message: "The Catalog synchronization failed because of an internal error.",
      };

  try {
    await catalogSync.failImport(syncRecordId, failure);
  } catch (recordError) {
    const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
    const message =
      recordError instanceof Error
        ? recordError.message
        : "The failure recorder threw a value that was not an Error.";
    logger.error(`Could not record failure for Catalog Sync Record ${syncRecordId}: ${message}`);
  }
}

function recordedFailure(record: SyncRecordRecord): MedusaError {
  if (!record.error_type || !record.error_message) {
    return new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Failed Catalog synchronization operation ${record.operation_id} has no stored error.`,
      "catalog_failure_record_invalid",
    );
  }

  return new MedusaError(record.error_type, record.error_message, record.error_code ?? undefined);
}

function fingerprint(value: CatalogFingerprintInput): string {
  return createHash("sha256").update(stringify(value)).digest("hex");
}
