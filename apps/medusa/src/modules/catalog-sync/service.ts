import type { Context, InferTypeOf, MedusaContainer } from "@medusajs/framework/types";
import { UniqueConstraintViolationException } from "@medusajs/framework/mikro-orm/core";
import {
  InjectTransactionManager,
  MedusaContext,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils";
import type {
  CatalogBatch,
  Options as OdooBridgeOptions,
  SourceRevision,
} from "@mze-store/odoo-bridge";
import { createOdooCatalogSource } from "./catalog-source";
import { catalogError } from "./errors";
import CatalogAttributeMapping from "~/modules/catalog-sync/models/catalog-attribute-mapping";
import CatalogAttributeValueMapping from "~/modules/catalog-sync/models/catalog-attribute-value-mapping";
import CatalogMapping from "~/modules/catalog-sync/models/catalog-mapping";
import CatalogVariantAttributeValue from "~/modules/catalog-sync/models/catalog-variant-attribute-value";
import SyncRecord from "~/modules/catalog-sync/models/sync-record";
import { CatalogSynchronizationResultSchema } from "./schema";
import type { CatalogSynchronizationResult } from "./schema";
import type {
  BeginCatalogSyncInput,
  CatalogIdentity,
  CatalogMappingSeed,
  CatalogMappingSnapshot,
  CatalogAttributeSnapshot,
  CatalogProjectionChange,
  CatalogProjectionCommit,
  CatalogProjectionMappingRef,
  CatalogProjectionReceipt,
  CatalogSource,
  CatalogSyncModuleOptions,
  CatalogSyncOutcome,
  CatalogSyncSource,
  CatalogSyncStart,
  CatalogValueSnapshot,
  MedusaErrorType,
} from "./types";

const OPERATION_ID_INDEX = "IDX_sync_record_operation_id_unique";
const SUCCEEDED = "succeeded" as const;
const CATALOG_IDENTITY_INDEXES = [
  "IDX_catalog_mapping_integration_key_unique",
  "IDX_catalog_mapping_source_record_unique",
  "IDX_catalog_mapping_product_unique",
  "IDX_catalog_mapping_variant_unique",
  "IDX_catalog_attribute_source_unique",
  "IDX_catalog_attribute_option_unique",
  "IDX_catalog_attribute_value_source_unique",
  "IDX_catalog_template_attribute_value_unique",
  "IDX_catalog_attribute_option_value_unique",
  "IDX_catalog_variant_attribute_unique",
  "IDX_catalog_variant_attribute_value_unique",
] as const;

export type CatalogAttributeMappingRecord = InferTypeOf<typeof CatalogAttributeMapping>;
export type CatalogAttributeValueMappingRecord = InferTypeOf<typeof CatalogAttributeValueMapping>;
export type CatalogMappingRecord = InferTypeOf<typeof CatalogMapping>;
export type CatalogVariantAttributeValueRecord = InferTypeOf<typeof CatalogVariantAttributeValue>;
export type SyncRecordRecord = InferTypeOf<typeof SyncRecord>;

export type CatalogProjectionRecords = Readonly<{
  template: CatalogMappingRecord;
  mappings: readonly CatalogMappingRecord[];
  attributes: readonly CatalogAttributeMappingRecord[];
  values: readonly CatalogAttributeValueMappingRecord[];
  selections: readonly CatalogVariantAttributeValueRecord[];
}>;

export default class CatalogSyncModuleService extends MedusaService({
  CatalogAttributeMapping,
  CatalogAttributeValueMapping,
  CatalogMapping,
  CatalogVariantAttributeValue,
  SyncRecord,
}) {
  readonly #source: CatalogSource;
  readonly #ownsSource: boolean;

  constructor(container: MedusaContainer, options: CatalogSyncModuleOptions) {
    super(container);
    if (options.source) {
      this.#source = options.source;
      this.#ownsSource = false;
    } else {
      // Build the bridge eagerly so invalid Odoo options stop the process at
      // boot instead of failing during the first remote read. The wrapper
      // resolves fetch per call, so a test can still replace globalThis.fetch
      // after construction.
      this.#source = createOdooCatalogSource(withResolvedFetch(options.odoo));
      this.#ownsSource = true;
    }
  }

  readonly __hooks = {
    onApplicationShutdown: async (): Promise<void> => {
      if (!this.#ownsSource) {
        return;
      }
      await this.#source.close();
    },
  };

  async startSync(input: BeginCatalogSyncInput): Promise<CatalogSyncStart> {
    const resumed = resumeStart(
      await this.#findSyncRecord(input.operationId),
      input.requestFingerprint,
    );
    if (resumed) {
      return resumed;
    }

    try {
      const record = await this.createSyncRecords({
        operation_id: input.operationId,
        request_fingerprint: input.requestFingerprint,
        state: "in_progress",
        attempts: 1,
        started_at: new Date(),
      });
      return { tag: "started", syncRecordId: record.id };
    } catch (thrown) {
      if (!(thrown instanceof Error) || !isExpectedUniqueConflict(thrown, [OPERATION_ID_INDEX])) {
        throw thrown;
      }

      const concurrent = await this.#findSyncRecord(input.operationId);
      const racedResume = resumeStart(concurrent, input.requestFingerprint);
      if (!racedResume) {
        throw thrown;
      }
      return racedResume;
    }
  }

  async readNextCatalogItem(
    options: Readonly<{ cursor?: SourceRevision | null; signal?: AbortSignal }> = {},
  ): Promise<CatalogBatch> {
    return this.#source.readNextCatalogItem(options);
  }

  @InjectTransactionManager()
  async recordSyncSource(
    syncRecordId: string,
    source: CatalogSyncSource,
    @MedusaContext() sharedContext: Context = {},
  ): Promise<void> {
    await this.#requireInProgressRecord(syncRecordId, sharedContext);
    await this.updateSyncRecords(
      {
        id: syncRecordId,
        response_fingerprint: source.sourceFingerprint,
        source_revision_changed_at: source.sourceRevision.changedAt,
        source_revision_product_id: source.sourceRevision.productId,
        next_cursor_changed_at: source.nextCursor?.changedAt ?? null,
        next_cursor_product_id: source.nextCursor?.productId ?? null,
      },
      sharedContext,
    );
  }

  @InjectTransactionManager()
  async finishSync(
    syncRecordId: string,
    outcome: CatalogSyncOutcome,
    @MedusaContext() sharedContext: Context = {},
  ): Promise<void> {
    const record = await this.#requireInProgressRecord(syncRecordId, sharedContext);
    if (outcome.tag === "failed") {
      await this.updateSyncRecords(
        {
          id: record.id,
          state: "failed",
          error_type: outcome.failure.type,
          error_code: outcome.failure.code,
          error_message: outcome.failure.message,
          finished_at: new Date(),
        },
        sharedContext,
      );
      return;
    }

    // Decode before writing so an invalid result can never enter storage.
    const decoded = CatalogSynchronizationResultSchema.safeParse(outcome.result);
    if (!decoded.success) {
      throw catalogError(
        "catalog_result_invalid",
        `Catalog synchronization operation ${record.operation_id} produced an invalid result.`,
      );
    }

    await this.updateSyncRecords(
      {
        id: record.id,
        state: "succeeded",
        response_fingerprint: outcome.sourceFingerprint,
        source_revision_changed_at: decoded.data.sourceRevision.changedAt,
        source_revision_product_id: decoded.data.sourceRevision.productId,
        next_cursor_changed_at: decoded.data.nextCursor?.changedAt ?? null,
        next_cursor_product_id: decoded.data.nextCursor?.productId ?? null,
        medusa_product_id: decoded.data.productId,
        result: decoded.data,
        error_type: null,
        error_code: null,
        error_message: null,
        finished_at: new Date(),
      },
      sharedContext,
    );
  }

  @InjectTransactionManager()
  async commitProjection(
    change: CatalogProjectionChange,
    @MedusaContext() sharedContext: Context = {},
  ): Promise<CatalogProjectionCommit> {
    if (change.tag === "touch") {
      return this.#touchProjection(change, sharedContext);
    }
    if (change.tag === "create") {
      return this.#createProjection(change, sharedContext);
    }
    return this.#updateProjection(change, sharedContext);
  }

  @InjectTransactionManager()
  async revertProjection(
    receipt: CatalogProjectionReceipt,
    @MedusaContext() sharedContext: Context = {},
  ): Promise<void> {
    if (receipt.createdSelectionIds.length) {
      await this.deleteCatalogVariantAttributeValues(
        [...receipt.createdSelectionIds],
        sharedContext,
      );
    }
    if (receipt.createdValueIds.length) {
      await this.deleteCatalogAttributeValueMappings([...receipt.createdValueIds], sharedContext);
    }
    if (receipt.createdMappingIds.length) {
      await this.deleteCatalogMappings([...receipt.createdMappingIds], sharedContext);
    }
    // Receipts cross the workflow engine as JSON, so their timestamps are
    // strings; convert them back before they touch a dateTime column.
    if (receipt.previousMappings.length) {
      await this.updateCatalogMappings(
        receipt.previousMappings.map((snapshot) => ({
          ...snapshot,
          last_synced_at: new Date(snapshot.last_synced_at),
        })),
        sharedContext,
      );
    }
    if (receipt.previousAttributes.length) {
      await this.updateCatalogAttributeMappings(
        receipt.previousAttributes.map((snapshot) => ({
          ...snapshot,
          last_synced_at: new Date(snapshot.last_synced_at),
        })),
        sharedContext,
      );
    }
    if (receipt.previousValues.length) {
      await this.updateCatalogAttributeValueMappings(
        receipt.previousValues.map((snapshot) => ({
          ...snapshot,
          last_synced_at: new Date(snapshot.last_synced_at),
        })),
        sharedContext,
      );
    }
  }

  async findCatalogProjection(input: {
    templateIntegrationKey: string;
    templateDatabaseId: number;
  }): Promise<CatalogProjectionRecords | null> {
    const candidates = await this.listCatalogMappings({
      $or: [
        { odoo_integration_key: input.templateIntegrationKey },
        { odoo_model: "product.template", odoo_database_id: input.templateDatabaseId },
      ],
    });
    if (!candidates.length) {
      return null;
    }

    const template = candidates.find(
      (mapping) =>
        mapping.odoo_model === "product.template" &&
        mapping.odoo_integration_key === input.templateIntegrationKey &&
        mapping.odoo_database_id === input.templateDatabaseId,
    );
    if (!template || candidates.length !== 1) {
      throw identityConflict();
    }

    const mappings = await this.listCatalogMappings({
      medusa_product_id: template.medusa_product_id,
    });
    const attributes = await this.listCatalogAttributeMappings({
      template_catalog_mapping_id: template.id,
    });
    const values = attributes.length
      ? await this.listCatalogAttributeValueMappings({
          catalog_attribute_mapping_id: attributes.map(({ id }) => id),
        })
      : [];
    const variantMappings = mappings.filter(({ odoo_model }) => odoo_model === "product.product");
    const selections = variantMappings.length
      ? await this.listCatalogVariantAttributeValues({
          variant_catalog_mapping_id: variantMappings.map(({ id }) => id),
        })
      : [];

    return { template, mappings, attributes, values, selections };
  }

  async assertCatalogIdentities(
    identities: readonly CatalogIdentity[],
    allowed?: Readonly<{ allowedMappingIds: readonly string[] }>,
  ): Promise<void> {
    if (!identities.length) {
      return;
    }

    const existing = await this.listCatalogMappings(identityFilter(identities));
    if (!allowed) {
      if (existing.length) {
        throw identityConflict();
      }
      return;
    }

    const allowedIds = new Set(allowed.allowedMappingIds);
    for (const mapping of existing) {
      const identity = identities.find(
        ({ odooIntegrationKey, odooModel, odooDatabaseId }) =>
          odooIntegrationKey === mapping.odoo_integration_key ||
          (odooModel === mapping.odoo_model && odooDatabaseId === mapping.odoo_database_id),
      );
      if (
        !identity ||
        !allowedIds.has(mapping.id) ||
        identity.odooIntegrationKey !== mapping.odoo_integration_key ||
        identity.odooModel !== mapping.odoo_model ||
        identity.odooDatabaseId !== mapping.odoo_database_id
      ) {
        throw identityConflict();
      }
    }
  }

  async #createProjection(
    change: Extract<CatalogProjectionChange, { tag: "create" }>,
    sharedContext: Context,
  ): Promise<CatalogProjectionCommit> {
    const now = new Date();
    const seeds = [change.template, ...change.variants];
    try {
      const mappings = await this.createCatalogMappings(
        seeds.map((seed) => toCreateMappingRow(seed, change, now)),
        sharedContext,
      );

      const template = mappings.find(({ odoo_model }) => odoo_model === "product.template");
      if (!template) {
        throw invalidProjection("The Catalog template mapping result is missing.");
      }
      const attributes = await this.createCatalogAttributeMappings(
        change.attributes.map((attribute) => ({
          template_catalog_mapping_id: template.id,
          odoo_attribute_id: attribute.odooAttributeId,
          variant_creation_mode: attribute.variantCreationMode,
          source_label: attribute.sourceLabel,
          medusa_product_option_id: attribute.medusaProductOptionId,
          last_sync_record_id: change.syncRecordId,
          last_synced_at: now,
        })),
        sharedContext,
      );
      const attributeByOdooId = new Map(
        attributes.map((attribute) => [attribute.odoo_attribute_id, attribute]),
      );
      const values = await this.createCatalogAttributeValueMappings(
        change.attributes.flatMap((attribute) => {
          const mapping = requireRow(attributeByOdooId.get(attribute.odooAttributeId));
          return attribute.values.map((value) => ({
            catalog_attribute_mapping_id: mapping.id,
            odoo_attribute_value_id: value.odooAttributeValueId,
            odoo_template_attribute_value_id: value.odooTemplateAttributeValueId,
            source_label: value.sourceLabel,
            medusa_product_option_value_id: value.medusaProductOptionValueId,
            last_sync_record_id: change.syncRecordId,
            last_synced_at: now,
          }));
        }),
        sharedContext,
      );

      const mappingByIntegrationKey = new Map(
        mappings.map((mapping) => [mapping.odoo_integration_key, mapping]),
      );
      const valueBySourceIdentity = new Map(
        values.map((value) => [
          `${value.catalog_attribute_mapping_id}:${value.odoo_attribute_value_id}`,
          value,
        ]),
      );
      const selections = await this.createCatalogVariantAttributeValues(
        change.variantSelections.flatMap((variantSelection) => {
          const seed = seedByIndex(change.variants, variantSelection.variantIndex);
          const mapping = requireRow(mappingByIntegrationKey.get(seed.odooIntegrationKey));

          return variantSelection.selections.map((selection) => {
            const attribute = requireRow(attributeByOdooId.get(selection.odooAttributeId));
            const value = requireRow(
              valueBySourceIdentity.get(`${attribute.id}:${selection.odooAttributeValueId}`),
            );

            return {
              variant_catalog_mapping_id: mapping.id,
              catalog_attribute_mapping_id: attribute.id,
              catalog_attribute_value_mapping_id: value.id,
              last_sync_record_id: change.syncRecordId,
              last_synced_at: now,
            };
          });
        }),
        sharedContext,
      );

      return {
        mappings: mappings.map(toMappingRef),
        receipt: {
          createdMappingIds: mappings.map(({ id }) => id),
          createdValueIds: [],
          createdSelectionIds: selections.map(({ id }) => id),
          previousMappings: [],
          previousAttributes: [],
          previousValues: [],
        },
      };
    } catch (thrown) {
      if (
        !(thrown instanceof Error) ||
        !isExpectedUniqueConflict(thrown, CATALOG_IDENTITY_INDEXES)
      ) {
        throw thrown;
      }

      throw identityConflict();
    }
  }

  async #updateProjection(
    change: Extract<CatalogProjectionChange, { tag: "update" }>,
    sharedContext: Context,
  ): Promise<CatalogProjectionCommit> {
    const now = new Date();
    const existingVariantIds = change.variants.flatMap((variant) =>
      variant.kind === "existing" ? [variant.mappingId] : [],
    );
    const existingValueIds = change.attributes.flatMap(({ values }) =>
      values.flatMap((value) => (value.kind === "existing" ? [value.mappingId] : [])),
    );

    const previousMappings = await this.listCatalogMappings(
      { id: [change.template.mappingId, ...existingVariantIds] },
      undefined,
      sharedContext,
    );
    const previousAttributes = change.attributes.length
      ? await this.listCatalogAttributeMappings(
          { id: change.attributes.map(({ mappingId }) => mappingId) },
          undefined,
          sharedContext,
        )
      : [];
    const previousValues = existingValueIds.length
      ? await this.listCatalogAttributeValueMappings(
          { id: existingValueIds },
          undefined,
          sharedContext,
        )
      : [];

    const updatedMappingRows = await this.updateCatalogMappings(
      [
        {
          id: change.template.mappingId,
          source_revision_changed_at: change.sourceRevision.changedAt,
          source_revision_product_id: change.sourceRevision.productId,
          source_fingerprint: change.sourceFingerprint,
          source_label: change.template.sourceLabel,
          archived: change.template.archived,
          last_sync_record_id: change.syncRecordId,
          sync_state: SUCCEEDED,
          last_synced_at: now,
        },
        ...change.variants.flatMap((variant) =>
          variant.kind === "existing"
            ? [
                {
                  id: variant.mappingId,
                  source_revision_changed_at: change.sourceRevision.changedAt,
                  source_revision_product_id: change.sourceRevision.productId,
                  source_fingerprint: change.sourceFingerprint,
                  source_label: variant.sourceLabel,
                  source_internal_reference: variant.sourceInternalReference,
                  source_barcode: variant.sourceBarcode,
                  archived: variant.archived,
                  last_sync_record_id: change.syncRecordId,
                  sync_state: SUCCEEDED,
                  last_synced_at: now,
                },
              ]
            : [],
        ),
      ],
      sharedContext,
    );
    const createdMappingRows = change.variants.some(({ kind }) => kind === "new")
      ? await this.createCatalogMappings(
          change.variants.flatMap((variant) =>
            variant.kind === "new" ? [toCreateMappingRow(variant, change, now)] : [],
          ),
          sharedContext,
        )
      : [];
    const allMappings = [...updatedMappingRows, ...createdMappingRows];
    const updatedAttributes = await this.updateCatalogAttributeMappings(
      change.attributes.map((attribute) => ({
        id: attribute.mappingId,
        source_label: attribute.sourceLabel,
        last_sync_record_id: change.syncRecordId,
        last_synced_at: now,
      })),
      sharedContext,
    );
    const updatedValues = existingValueIds.length
      ? await this.updateCatalogAttributeValueMappings(
          change.attributes.flatMap(({ values }) =>
            values.flatMap((value) =>
              value.kind === "existing"
                ? [
                    {
                      id: value.mappingId,
                      source_label: value.sourceLabel,
                      last_sync_record_id: change.syncRecordId,
                      last_synced_at: now,
                    },
                  ]
                : [],
            ),
          ),
          sharedContext,
        )
      : [];
    const createdValues = change.attributes.some(({ values }) =>
      values.some(({ kind }) => kind === "new"),
    )
      ? await this.createCatalogAttributeValueMappings(
          change.attributes.flatMap((attribute) => {
            const parent = requireRow(
              updatedAttributes.find(({ id }) => id === attribute.mappingId),
              "A new Catalog value has no attribute mapping.",
            );

            return attribute.values.flatMap((value) =>
              value.kind === "new"
                ? [
                    {
                      catalog_attribute_mapping_id: parent.id,
                      odoo_attribute_value_id: value.odooAttributeValueId,
                      odoo_template_attribute_value_id: value.odooTemplateAttributeValueId,
                      source_label: value.sourceLabel,
                      medusa_product_option_value_id: value.medusaProductOptionValueId,
                      last_sync_record_id: change.syncRecordId,
                      last_synced_at: now,
                    },
                  ]
                : [],
            );
          }),
          sharedContext,
        )
      : [];

    const attributeByOdooId = new Map(
      updatedAttributes.map((attribute) => [attribute.odoo_attribute_id, attribute]),
    );
    const createdMappingByIntegrationKey = new Map(
      createdMappingRows.map((mapping) => [mapping.odoo_integration_key, mapping]),
    );
    const valueBySourceIdentity = new Map(
      [...updatedValues, ...createdValues].map((value) => [
        `${value.catalog_attribute_mapping_id}:${value.odoo_attribute_value_id}`,
        value,
      ]),
    );
    const createdSelections = change.newVariantSelections.length
      ? await this.createCatalogVariantAttributeValues(
          change.newVariantSelections.flatMap((variantSelection) => {
            const variant = change.variants[variantSelection.variantIndex];
            if (!variant || variant.kind !== "new") {
              throw invalidProjection("A new Catalog Variant selection names an unknown Variant.");
            }
            const mapping = requireRow(
              createdMappingByIntegrationKey.get(variant.odooIntegrationKey),
              "A new Catalog Variant has no mapping.",
            );

            return variantSelection.selections.map((selection) => {
              const attribute = requireRow(attributeByOdooId.get(selection.odooAttributeId));
              const value = requireRow(
                valueBySourceIdentity.get(`${attribute.id}:${selection.odooAttributeValueId}`),
              );

              return {
                variant_catalog_mapping_id: mapping.id,
                catalog_attribute_mapping_id: attribute.id,
                catalog_attribute_value_mapping_id: value.id,
                last_sync_record_id: change.syncRecordId,
                last_synced_at: now,
              };
            });
          }),
          sharedContext,
        )
      : [];

    return {
      mappings: allMappings.map(toMappingRef),
      receipt: {
        createdMappingIds: createdMappingRows.map(({ id }) => id),
        createdValueIds: createdValues.map(({ id }) => id),
        createdSelectionIds: createdSelections.map(({ id }) => id),
        previousMappings: previousMappings.map(toMappingSnapshot),
        previousAttributes: previousAttributes.map(toAttributeSnapshot),
        previousValues: previousValues.map(toValueSnapshot),
      },
    };
  }

  async #touchProjection(
    change: Extract<CatalogProjectionChange, { tag: "touch" }>,
    sharedContext: Context,
  ): Promise<CatalogProjectionCommit> {
    const now = new Date();
    if (change.mappingIds.length) {
      await this.updateCatalogMappings(
        change.mappingIds.map((id) => ({
          id,
          last_sync_record_id: change.syncRecordId,
          sync_state: SUCCEEDED,
          last_synced_at: now,
        })),
        sharedContext,
      );
    }
    if (change.attributeIds.length) {
      await this.updateCatalogAttributeMappings(
        change.attributeIds.map((id) => ({
          id,
          last_sync_record_id: change.syncRecordId,
          last_synced_at: now,
        })),
        sharedContext,
      );
    }
    if (change.valueIds.length) {
      await this.updateCatalogAttributeValueMappings(
        change.valueIds.map((id) => ({
          id,
          last_sync_record_id: change.syncRecordId,
          last_synced_at: now,
        })),
        sharedContext,
      );
    }
    if (change.selectionIds.length) {
      await this.updateCatalogVariantAttributeValues(
        change.selectionIds.map((id) => ({
          id,
          last_sync_record_id: change.syncRecordId,
          last_synced_at: now,
        })),
        sharedContext,
      );
    }

    return {
      mappings: [],
      receipt: emptyReceipt(),
    };
  }

  async #findSyncRecord(operationId: string): Promise<SyncRecordRecord | undefined> {
    const [record] = await this.listSyncRecords({ operation_id: operationId }, { take: 1 });
    return record;
  }

  async #requireInProgressRecord(
    syncRecordId: string,
    sharedContext: Context,
  ): Promise<SyncRecordRecord> {
    const [record] = await this.listSyncRecords({ id: syncRecordId }, {}, sharedContext);
    if (!record) {
      throw catalogError(
        "catalog_projection_result_invalid",
        `Catalog Sync Record ${syncRecordId} does not exist.`,
      );
    }
    if (record.state !== "in_progress") {
      throw catalogError(
        "catalog_operation_conflict",
        `Catalog synchronization operation ${record.operation_id} is already ${record.state}.`,
      );
    }

    return record;
  }
}

function withResolvedFetch(options: OdooBridgeOptions): OdooBridgeOptions {
  if (options.fetch) {
    return options;
  }

  return {
    ...options,
    fetch: (...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args),
  };
}

function resumeStart(
  record: SyncRecordRecord | undefined,
  requestFingerprint: string,
): CatalogSyncStart | undefined {
  if (!record) {
    return undefined;
  }

  assertSameRequest(record, requestFingerprint);
  switch (record.state) {
    case "succeeded":
      return { tag: "replayed", result: decodeStoredResult(record) };
    case "failed":
      throw recordedFailure(record);
    default:
      throw catalogError(
        "catalog_operation_in_progress",
        `Catalog synchronization operation ${record.operation_id} is already in progress.`,
      );
  }
}

function decodeStoredResult(record: SyncRecordRecord): CatalogSynchronizationResult {
  const decoded = CatalogSynchronizationResultSchema.safeParse(record.result);
  if (!decoded.success) {
    throw catalogError(
      "catalog_result_invalid",
      `Catalog synchronization operation ${record.operation_id} has an invalid stored result.`,
    );
  }

  return decoded.data;
}

function recordedFailure(record: SyncRecordRecord): MedusaError {
  if (!record.error_type || !record.error_message) {
    return catalogError(
      "catalog_failure_record_invalid",
      `Failed Catalog synchronization operation ${record.operation_id} has no stored error.`,
    );
  }

  const knownTypes: readonly string[] = Object.values(MedusaError.Types);
  const type = knownTypes.includes(record.error_type)
    ? (record.error_type as MedusaErrorType)
    : MedusaError.Types.UNEXPECTED_STATE;
  return new MedusaError(type, record.error_message, record.error_code ?? undefined);
}

function assertSameRequest(record: SyncRecordRecord, requestFingerprint: string): void {
  if (record.request_fingerprint === requestFingerprint) {
    return;
  }

  throw catalogError(
    "catalog_operation_conflict",
    `Catalog import operation ${record.operation_id} was already used for a different request.`,
  );
}

function identityFilter(identities: readonly CatalogIdentity[]) {
  return {
    $or: [
      { odoo_integration_key: identities.map(({ odooIntegrationKey }) => odooIntegrationKey) },
      ...identities.map(({ odooModel, odooDatabaseId }) => ({
        odoo_model: odooModel,
        odoo_database_id: odooDatabaseId,
      })),
    ],
  };
}

function identityConflict(): MedusaError {
  return catalogError(
    "catalog_identity_conflict",
    "The Odoo Product identity is already mapped to another Medusa Product.",
  );
}

function invalidProjection(message: string): MedusaError {
  return catalogError("catalog_projection_result_invalid", message);
}

function emptyReceipt(): CatalogProjectionReceipt {
  return {
    createdMappingIds: [],
    createdValueIds: [],
    createdSelectionIds: [],
    previousMappings: [],
    previousAttributes: [],
    previousValues: [],
  };
}

function requireRow<Row>(
  row: Row | undefined | null,
  message = "The Catalog projection result is incomplete.",
): Row {
  if (!row) {
    throw invalidProjection(message);
  }

  return row;
}

function toCreateMappingRow(
  seed: CatalogMappingSeed,
  change: { syncRecordId: string; sourceFingerprint: string; sourceRevision: SourceRevision },
  now: Date,
) {
  return {
    odoo_model: seed.odooModel,
    odoo_database_id: seed.odooDatabaseId,
    odoo_integration_key: seed.odooIntegrationKey,
    source_revision_changed_at: change.sourceRevision.changedAt,
    source_revision_product_id: change.sourceRevision.productId,
    source_fingerprint: change.sourceFingerprint,
    source_label: seed.sourceLabel,
    source_internal_reference: seed.sourceInternalReference,
    source_barcode: seed.sourceBarcode,
    medusa_product_id: seed.medusaProductId,
    medusa_variant_id: seed.medusaVariantId,
    last_sync_record_id: change.syncRecordId,
    sync_state: SUCCEEDED,
    archived: seed.archived,
    last_synced_at: now,
  };
}

function seedByIndex(
  variants: readonly CatalogMappingSeed[],
  variantIndex: number,
): CatalogMappingSeed {
  const seed = variants[variantIndex];
  if (!seed) {
    throw invalidProjection(
      `The Catalog projection change has no Variant at index ${variantIndex}.`,
    );
  }

  return seed;
}

function toMappingRef(mapping: CatalogMappingRecord): CatalogProjectionMappingRef {
  return {
    id: mapping.id,
    odooModel: mapping.odoo_model,
    odooIntegrationKey: mapping.odoo_integration_key,
    medusaProductId: mapping.medusa_product_id,
    medusaVariantId: mapping.medusa_variant_id,
  };
}

function toMappingSnapshot(mapping: CatalogMappingRecord): CatalogMappingSnapshot {
  return {
    id: mapping.id,
    source_revision_changed_at: mapping.source_revision_changed_at,
    source_revision_product_id: mapping.source_revision_product_id,
    source_fingerprint: mapping.source_fingerprint,
    source_label: mapping.source_label,
    source_internal_reference: mapping.source_internal_reference,
    source_barcode: mapping.source_barcode,
    archived: mapping.archived,
    last_sync_record_id: mapping.last_sync_record_id,
    last_synced_at: toIsoTime(mapping.last_synced_at),
  };
}

function toAttributeSnapshot(attribute: CatalogAttributeMappingRecord): CatalogAttributeSnapshot {
  return {
    id: attribute.id,
    source_label: attribute.source_label,
    last_sync_record_id: attribute.last_sync_record_id,
    last_synced_at: toIsoTime(attribute.last_synced_at),
  };
}

function toValueSnapshot(value: CatalogAttributeValueMappingRecord): CatalogValueSnapshot {
  return {
    id: value.id,
    source_label: value.source_label,
    last_sync_record_id: value.last_sync_record_id,
    last_synced_at: toIsoTime(value.last_synced_at),
  };
}

function toIsoTime(value: Date): string {
  return value.toISOString();
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

export type CatalogSyncModule = Pick<
  CatalogSyncModuleService,
  | "assertCatalogIdentities"
  | "commitProjection"
  | "findCatalogProjection"
  | "finishSync"
  | "readNextCatalogItem"
  | "revertProjection"
  | "recordSyncSource"
  | "startSync"
>;
