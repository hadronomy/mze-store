import type { ILockingModule, Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, MedusaError, Modules } from "@medusajs/framework/utils";
import type { CatalogBatch, CatalogItem, OdooBridgeError } from "@mze-store/odoo-bridge";
import stringify from "fast-json-stable-stringify";
import { createHash } from "node:crypto";
import { CATALOG_SYNC_MODULE } from "~/modules/catalog-sync";
import type { CatalogSyncModule, SyncRecordRecord } from "~/modules/catalog-sync/service";
import type { CatalogCursor } from "~/modules/catalog-sync/types";
import {
  createCatalogProductWorkflow,
  type CreatedCatalogProduct,
  type PreparedCatalogImport,
} from "~/workflows/catalog-product-import";

export type ImportCatalogItemInput = Readonly<{
  operationId: string;
  cursor?: CatalogCursor | null;
  signal?: AbortSignal;
}>;

export type ImportCatalogItemResult = CreatedCatalogProduct &
  Readonly<{ disposition: "created" | "replayed" }>;

export async function importCatalogItem(
  container: MedusaContainer,
  input: ImportCatalogItemInput,
): Promise<ImportCatalogItemResult> {
  const requestFingerprint = fingerprint({
    operation: "catalog.import",
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
        return replayCatalogImport(begun.record);
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

        const prepared = prepareCatalogImport(inProgress.id, batchResult.success);
        await catalogSync.recordImportSource(inProgress.id, toImportSource(prepared));
        const sourceVariant = prepared.item.variants[0]!;
        await catalogSync.assertCatalogIdentitiesAvailable({
          templateIntegrationKey: prepared.item.template.integrationKey,
          templateDatabaseId: prepared.item.template.id,
          variantIntegrationKey: sourceVariant.integrationKey,
          variantDatabaseId: sourceVariant.id,
        });
        const { result } = await createCatalogProductWorkflow(container).run({
          input: prepared,
          context: { transactionId: input.operationId },
        });

        return { ...result, disposition: "created" };
      } catch (thrown) {
        const error =
          thrown instanceof Error
            ? thrown
            : new Error("The Catalog import threw a value that was not an Error.");
        await recordFailure(container, catalogSync, inProgress.id, error);
        throw error;
      }
    },
    { timeout: 30 },
  );
}

function prepareCatalogImport(syncRecordId: string, batch: CatalogBatch): PreparedCatalogImport {
  if (batch.items.length === 0) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "Odoo returned no active Catalog Item for this cursor.",
      "catalog_source_empty",
    );
  }
  if (batch.items.length !== 1) {
    throw sourceRejected("Odoo returned more than one Catalog Item for a limit of one.");
  }

  const item = batch.items[0]!;
  validateFirstSlice(item);

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

function validateFirstSlice(item: CatalogItem): void {
  const { template } = item;
  const [variant] = item.variants;

  if (!template.active || !template.saleOk) {
    throw sourceRejected("The Odoo Product must be active and available for sale.");
  }
  if (item.sourceRevision.productId !== template.id) {
    throw sourceRejected("The Source Revision does not identify its Odoo Product template.");
  }
  if (template.attributes.length !== 0) {
    throw sourceRejected("The first Catalog intake slice accepts a variant-less Odoo Product.");
  }
  if (!variant || item.variants.length !== 1) {
    throw sourceRejected("The first Catalog intake slice requires exactly one Odoo Variant.");
  }
  if (!variant.active || !variant.saleOk) {
    throw sourceRejected("The Odoo Variant must be active and available for sale.");
  }
  if (variant.attributeValues.length !== 0) {
    throw sourceRejected("The Odoo Variant must not carry shopper-facing option values.");
  }
  if (template.integrationKey === variant.integrationKey) {
    throw sourceRejected("The Odoo template and Variant must have different Integration Keys.");
  }

  const price = Number(variant.price);
  if (!Number.isFinite(price) || price < 0) {
    throw sourceRejected("The Odoo Variant price must be a finite non-negative amount.");
  }
}

function toImportSource(prepared: PreparedCatalogImport) {
  const variant = prepared.item.variants[0]!;
  return {
    templateIntegrationKey: prepared.item.template.integrationKey,
    variantIntegrationKey: variant.integrationKey,
    sourceFingerprint: prepared.sourceFingerprint,
    sourceRevision: prepared.item.sourceRevision,
    nextCursor: prepared.nextCursor,
  };
}

function replayCatalogImport(record: SyncRecordRecord): ImportCatalogItemResult {
  if (record.state === "failed" || record.state === "dead_letter") {
    throw recordedFailure(record);
  }
  if (record.state !== "succeeded") {
    throw new MedusaError(
      MedusaError.Types.CONFLICT,
      `Catalog import operation ${record.operation_id} is already ${record.state}.`,
      "catalog_operation_in_progress",
    );
  }

  const productId = requireStoredValue(record, "medusa_product_id");
  const variantId = requireStoredValue(record, "medusa_variant_id");
  const templateMappingId = requireStoredValue(record, "template_catalog_mapping_id");
  const variantMappingId = requireStoredValue(record, "variant_catalog_mapping_id");
  const sourceRevision = decodeStoredRevision(
    requireStoredValue(record, "source_revision_changed_at"),
    requireStoredValue(record, "source_revision_product_id"),
  );
  const nextCursor =
    record.next_cursor_changed_at === null || record.next_cursor_product_id === null
      ? null
      : decodeStoredRevision(record.next_cursor_changed_at, record.next_cursor_product_id);

  return {
    disposition: "replayed",
    syncRecordId: record.id,
    productId,
    variantId,
    catalogMappingIds: { template: templateMappingId, variant: variantMappingId },
    sourceRevision,
    nextCursor,
  };
}

function bridgeFailureError(error: OdooBridgeError): MedusaError {
  switch (error._tag) {
    case "OdooBridgeCallAborted":
      return new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "The Catalog import was cancelled during the Odoo read.",
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
        message: "The Catalog import failed because of an internal error.",
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
      `Failed Catalog import operation ${record.operation_id} has no stored error.`,
      "catalog_failure_record_invalid",
    );
  }

  return new MedusaError(record.error_type, record.error_message, record.error_code ?? undefined);
}

function decodeStoredRevision(changedAt: string, productId: number): CatalogCursor {
  return { changedAt, productId };
}

function requireStoredValue<Key extends keyof SyncRecordRecord>(
  record: SyncRecordRecord,
  key: Key,
): NonNullable<SyncRecordRecord[Key]> {
  const value = record[key];
  if (value === null || value === undefined) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Succeeded Catalog import operation ${record.operation_id} has no ${String(key)}.`,
      "catalog_result_record_invalid",
    );
  }

  return value;
}

type FingerprintInput =
  | Readonly<{ operation: "catalog.import"; cursor: CatalogCursor | null }>
  | Readonly<{
      contractVersion: CatalogBatch["contractVersion"];
      item: CatalogItem;
      priceList: CatalogBatch["priceList"];
    }>;

function fingerprint(value: FingerprintInput): string {
  return createHash("sha256").update(stringify(value)).digest("hex");
}
