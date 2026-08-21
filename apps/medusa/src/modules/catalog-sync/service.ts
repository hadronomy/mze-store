import type { InferTypeOf, MedusaContainer } from "@medusajs/framework/types";
import { UniqueConstraintViolationException } from "@medusajs/framework/mikro-orm/core";
import { MedusaError, MedusaService } from "@medusajs/framework/utils";
import type { OdooBridgeGateway, ReadCatalogBatchResult } from "@mze-store/odoo-bridge";
import CatalogMapping from "~/modules/catalog-sync/models/catalog-mapping";
import SyncRecord from "~/modules/catalog-sync/models/sync-record";
import type {
  BeginCatalogImportInput,
  CatalogImportFailure,
  CatalogImportSource,
  CatalogCursor,
  CatalogSyncModuleOptions,
  CompleteCatalogImportInput,
  CreateCatalogMappingInput,
  OwnedOdooBridgeClient,
} from "./types";

const OPERATION_ID_INDEX = "IDX_sync_record_operation_id_unique";
const SUCCEEDED = "succeeded" as const;
const CATALOG_IDENTITY_INDEXES = [
  "IDX_catalog_mapping_integration_key_unique",
  "IDX_catalog_mapping_source_record_unique",
  "IDX_catalog_mapping_product_unique",
  "IDX_catalog_mapping_variant_unique",
] as const;

export type CatalogMappingRecord = InferTypeOf<typeof CatalogMapping>;
export type SyncRecordRecord = InferTypeOf<typeof SyncRecord>;

export default class CatalogSyncModuleService extends MedusaService({
  CatalogMapping,
  SyncRecord,
}) {
  readonly #options: CatalogSyncModuleOptions;
  #gateway: OdooBridgeGateway | undefined;
  #gatewayPromise: Promise<OdooBridgeGateway> | undefined;
  #ownedClient: OwnedOdooBridgeClient;

  constructor(container: MedusaContainer, options: CatalogSyncModuleOptions) {
    super(container);
    this.#options = options;
    this.#gateway = options.gateway;
  }

  readonly __hooks = {
    onApplicationShutdown: async (): Promise<void> => {
      await this.#ownedClient?.close();
    },
  };

  async readCatalogBatch(options: {
    cursor?: CatalogCursor | null;
    limit: 1;
    signal?: AbortSignal;
  }): Promise<ReadCatalogBatchResult> {
    const gateway = await this.#resolveGateway();
    const cursor = options.cursor
      ? (await import("@mze-store/odoo-bridge")).decodeSourceRevision({
          write_date: options.cursor.changedAt,
          id: options.cursor.productId,
        })
      : null;

    return gateway.readCatalogBatch({ cursor, limit: options.limit, signal: options.signal });
  }

  async beginImport(input: BeginCatalogImportInput): Promise<BeginCatalogImportResult> {
    const existing = await this.findSyncRecord(input.operationId);
    if (existing) {
      assertSameRequest(existing, input.requestFingerprint);
      return { record: existing, created: false };
    }

    try {
      const record = await this.createSyncRecords({
        operation_id: input.operationId,
        request_fingerprint: input.requestFingerprint,
        state: "pending",
        attempts: 0,
      });
      return { record, created: true };
    } catch (thrown) {
      if (!(thrown instanceof Error) || !isExpectedUniqueConflict(thrown, [OPERATION_ID_INDEX])) {
        throw thrown;
      }

      const concurrent = await this.findSyncRecord(input.operationId);
      if (!concurrent) {
        throw thrown;
      }

      assertSameRequest(concurrent, input.requestFingerprint);
      return { record: concurrent, created: false };
    }
  }

  async markImportInProgress(record: SyncRecordRecord): Promise<SyncRecordRecord> {
    if (record.state !== "pending") {
      throw operationStateError(record);
    }

    return this.updateSyncRecords({
      id: record.id,
      state: "in_progress",
      attempts: record.attempts + 1,
      started_at: new Date(),
      finished_at: null,
    });
  }

  async recordImportSource(
    syncRecordId: string,
    source: CatalogImportSource,
  ): Promise<SyncRecordRecord> {
    return this.updateSyncRecords({
      id: syncRecordId,
      response_fingerprint: source.sourceFingerprint,
      source_template_integration_key: source.templateIntegrationKey,
      source_variant_integration_key: source.variantIntegrationKey,
      source_revision_changed_at: source.sourceRevision.changedAt,
      source_revision_product_id: source.sourceRevision.productId,
      next_cursor_changed_at: source.nextCursor?.changedAt ?? null,
      next_cursor_product_id: source.nextCursor?.productId ?? null,
    });
  }

  async createMappings(
    inputs: readonly CreateCatalogMappingInput[],
  ): Promise<CatalogMappingRecord[]> {
    const now = new Date();
    try {
      return await this.createCatalogMappings(
        inputs.map((input) => ({
          odoo_model: input.odooModel,
          odoo_database_id: input.odooDatabaseId,
          odoo_integration_key: input.odooIntegrationKey,
          source_revision_changed_at: input.sourceRevision.changedAt,
          source_revision_product_id: input.sourceRevision.productId,
          source_fingerprint: input.sourceFingerprint,
          medusa_product_id: input.medusaProductId,
          medusa_variant_id: input.medusaVariantId,
          last_sync_record_id: input.syncRecordId,
          sync_state: SUCCEEDED,
          archived: false,
          last_synced_at: now,
        })),
      );
    } catch (thrown) {
      if (
        !(thrown instanceof Error) ||
        !isExpectedUniqueConflict(thrown, CATALOG_IDENTITY_INDEXES)
      ) {
        throw thrown;
      }

      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The Odoo Product identity is already mapped to another Medusa Product.",
        "catalog_identity_conflict",
      );
    }
  }

  async assertCatalogIdentitiesAvailable(input: {
    templateIntegrationKey: string;
    templateDatabaseId: number;
    variantIntegrationKey: string;
    variantDatabaseId: number;
  }): Promise<void> {
    const existing = await this.listCatalogMappings({
      $or: [
        {
          odoo_integration_key: [input.templateIntegrationKey, input.variantIntegrationKey],
        },
        { odoo_model: "product.template", odoo_database_id: input.templateDatabaseId },
        { odoo_model: "product.product", odoo_database_id: input.variantDatabaseId },
      ],
    });

    if (existing.length) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        "The Odoo Product identity is already mapped to another Medusa Product.",
        "catalog_identity_conflict",
      );
    }
  }

  async completeImport(input: CompleteCatalogImportInput): Promise<SyncRecordRecord> {
    return this.updateSyncRecords({
      id: input.syncRecordId,
      response_fingerprint: input.sourceFingerprint,
      state: "succeeded",
      source_template_integration_key: input.templateIntegrationKey,
      source_variant_integration_key: input.variantIntegrationKey,
      source_revision_changed_at: input.sourceRevision.changedAt,
      source_revision_product_id: input.sourceRevision.productId,
      next_cursor_changed_at: input.nextCursor?.changedAt ?? null,
      next_cursor_product_id: input.nextCursor?.productId ?? null,
      medusa_product_id: input.productId,
      medusa_variant_id: input.variantId,
      template_catalog_mapping_id: input.templateCatalogMappingId,
      variant_catalog_mapping_id: input.variantCatalogMappingId,
      error_type: null,
      error_code: null,
      error_message: null,
      finished_at: new Date(),
      next_attempt_at: null,
    });
  }

  async failImport(syncRecordId: string, failure: CatalogImportFailure): Promise<SyncRecordRecord> {
    return this.updateSyncRecords({
      id: syncRecordId,
      state: "failed",
      error_type: failure.type,
      error_code: failure.code,
      error_message: failure.message,
      finished_at: new Date(),
      next_attempt_at: null,
    });
  }

  private async findSyncRecord(operationId: string): Promise<SyncRecordRecord | undefined> {
    const [record] = await this.listSyncRecords({ operation_id: operationId }, { take: 1 });
    return record;
  }

  async #resolveGateway(): Promise<OdooBridgeGateway> {
    if (this.#gateway) {
      return this.#gateway;
    }
    if (this.#gatewayPromise) {
      return this.#gatewayPromise;
    }

    this.#gatewayPromise = import("@mze-store/odoo-bridge").then((bridge) => {
      const client = bridge.createOdooBridge(this.#options.odoo);
      if (client._tag === "Failure") {
        throw new MedusaError(
          MedusaError.Types.INVALID_ARGUMENT,
          client.failure.message,
          "catalog_bridge_configuration_invalid",
        );
      }

      this.#ownedClient = client.success;
      this.#gateway = client.success;
      return client.success;
    });

    return this.#gatewayPromise;
  }
}

export type CatalogSyncModule = Pick<
  CatalogSyncModuleService,
  | "beginImport"
  | "assertCatalogIdentitiesAvailable"
  | "completeImport"
  | "createMappings"
  | "deleteCatalogMappings"
  | "failImport"
  | "markImportInProgress"
  | "readCatalogBatch"
  | "recordImportSource"
>;

type BeginCatalogImportResult = Readonly<{
  record: SyncRecordRecord;
  created: boolean;
}>;

function assertSameRequest(record: SyncRecordRecord, requestFingerprint: string): void {
  if (record.request_fingerprint === requestFingerprint) {
    return;
  }

  throw new MedusaError(
    MedusaError.Types.CONFLICT,
    `Catalog import operation ${record.operation_id} was already used for a different request.`,
    "catalog_operation_conflict",
  );
}

function operationStateError(record: SyncRecordRecord): MedusaError {
  return new MedusaError(
    MedusaError.Types.CONFLICT,
    `Catalog import operation ${record.operation_id} is already ${record.state}.`,
    "catalog_operation_in_progress",
  );
}

function isExpectedUniqueConflict(
  error: Error,
  indexNames: readonly string[],
): error is UniqueConstraintViolationException {
  if (!(error instanceof UniqueConstraintViolationException)) {
    return false;
  }

  const databaseMessage = `${error.message} ${error.sqlMessage ?? ""} ${error.errmsg ?? ""}`;
  return error.code === "23505" && indexNames.some((name) => databaseMessage.includes(name));
}
