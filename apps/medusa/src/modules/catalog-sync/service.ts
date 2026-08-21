import type { Context, InferTypeOf, MedusaContainer } from "@medusajs/framework/types";
import { UniqueConstraintViolationException } from "@medusajs/framework/mikro-orm/core";
import {
  InjectTransactionManager,
  MedusaContext,
  MedusaError,
  MedusaService,
} from "@medusajs/framework/utils";
import type { ReadCatalogBatchResult } from "@mze-store/odoo-bridge";
import { createOdooCatalogSource } from "./catalog-source";
import CatalogAttributeMapping from "~/modules/catalog-sync/models/catalog-attribute-mapping";
import CatalogAttributeValueMapping from "~/modules/catalog-sync/models/catalog-attribute-value-mapping";
import CatalogMapping from "~/modules/catalog-sync/models/catalog-mapping";
import CatalogVariantAttributeValue from "~/modules/catalog-sync/models/catalog-variant-attribute-value";
import SyncRecord from "~/modules/catalog-sync/models/sync-record";
import type {
  BeginCatalogImportInput,
  CatalogImportFailure,
  CatalogImportSource,
  CatalogCursor,
  CatalogSource,
  CatalogSyncModuleOptions,
  CompleteCatalogImportInput,
  CreateCatalogProjectionInput,
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

export default class CatalogSyncModuleService extends MedusaService({
  CatalogAttributeMapping,
  CatalogAttributeValueMapping,
  CatalogMapping,
  CatalogVariantAttributeValue,
  SyncRecord,
}) {
  readonly #options: CatalogSyncModuleOptions;
  #source: CatalogSource | undefined;
  #sourcePromise: Promise<CatalogSource> | undefined;
  #ownedSource: CatalogSource | undefined;

  constructor(container: MedusaContainer, options: CatalogSyncModuleOptions) {
    super(container);
    this.#options = options;
    this.#source = options.source;
  }

  readonly __hooks = {
    onApplicationShutdown: async (): Promise<void> => {
      await this.#ownedSource?.close();
    },
  };

  async readCatalogBatch(options: {
    cursor?: CatalogCursor | null;
    limit: 1;
    signal?: AbortSignal;
  }): Promise<ReadCatalogBatchResult> {
    const source = await this.#resolveSource();
    return source.readCatalogBatch(options);
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
      source_revision_changed_at: source.sourceRevision.changedAt,
      source_revision_product_id: source.sourceRevision.productId,
      next_cursor_changed_at: source.nextCursor?.changedAt ?? null,
      next_cursor_product_id: source.nextCursor?.productId ?? null,
    });
  }

  @InjectTransactionManager()
  async createCatalogProjection(
    input: CreateCatalogProjectionInput,
    @MedusaContext() sharedContext: Context = {},
  ): Promise<CreatedCatalogProjection> {
    const now = new Date();
    try {
      const mappings = await this.createCatalogMappings(
        input.mappings.map((mapping) => ({
          odoo_model: mapping.odooModel,
          odoo_database_id: mapping.odooDatabaseId,
          odoo_integration_key: mapping.odooIntegrationKey,
          source_revision_changed_at: mapping.sourceRevision.changedAt,
          source_revision_product_id: mapping.sourceRevision.productId,
          source_fingerprint: mapping.sourceFingerprint,
          source_label: mapping.sourceLabel,
          source_internal_reference: mapping.sourceInternalReference,
          source_barcode: mapping.sourceBarcode,
          medusa_product_id: mapping.medusaProductId,
          medusa_variant_id: mapping.medusaVariantId,
          last_sync_record_id: mapping.syncRecordId,
          sync_state: SUCCEEDED,
          archived: mapping.archived,
          last_synced_at: now,
        })),
        sharedContext,
      );
      const template = requireTemplateMapping(mappings);
      const mappingByIntegrationKey = new Map(
        mappings.map((mapping) => [mapping.odoo_integration_key, mapping]),
      );
      const attributes = await this.createCatalogAttributeMappings(
        input.attributes.map((attribute) => ({
          template_catalog_mapping_id: template.id,
          odoo_attribute_id: attribute.odooAttributeId,
          variant_creation_mode: attribute.variantCreationMode,
          source_label: attribute.sourceLabel,
          medusa_product_option_id: attribute.medusaProductOptionId,
          last_sync_record_id: input.mappings[0]!.syncRecordId,
          last_synced_at: now,
        })),
        sharedContext,
      );
      const attributeByOdooId = new Map(
        attributes.map((attribute) => [attribute.odoo_attribute_id, attribute]),
      );
      const values = await this.createCatalogAttributeValueMappings(
        input.attributes.flatMap((attribute) => {
          const mapping = attributeByOdooId.get(attribute.odooAttributeId);
          if (!mapping) {
            throw invalidProjection("The Catalog attribute mapping result is incomplete.");
          }

          return attribute.values.map((value) => ({
            catalog_attribute_mapping_id: mapping.id,
            odoo_attribute_value_id: value.odooAttributeValueId,
            odoo_template_attribute_value_id: value.odooTemplateAttributeValueId,
            source_label: value.sourceLabel,
            medusa_product_option_value_id: value.medusaProductOptionValueId,
            last_sync_record_id: input.mappings[0]!.syncRecordId,
            last_synced_at: now,
          }));
        }),
        sharedContext,
      );
      const valueBySourceIdentity = new Map(
        values.map((value) => [
          `${value.catalog_attribute_mapping_id}:${value.odoo_attribute_value_id}`,
          value,
        ]),
      );
      const selections = await this.createCatalogVariantAttributeValues(
        input.variantSelections.flatMap((variantSelection) => {
          const variantMapping = mappingByIntegrationKey.get(
            variantSelection.variantIntegrationKey,
          );
          if (!variantMapping) {
            throw invalidProjection("The Catalog Variant mapping result is incomplete.");
          }

          return variantSelection.selections.map((selection) => {
            const attributeMapping = attributeByOdooId.get(selection.odooAttributeId);
            const valueMapping = attributeMapping
              ? valueBySourceIdentity.get(
                  `${attributeMapping.id}:${selection.odooAttributeValueId}`,
                )
              : undefined;
            if (!attributeMapping || !valueMapping) {
              throw invalidProjection("A Catalog Variant selection has no attribute mapping.");
            }

            return {
              variant_catalog_mapping_id: variantMapping.id,
              catalog_attribute_mapping_id: attributeMapping.id,
              catalog_attribute_value_mapping_id: valueMapping.id,
              last_sync_record_id: input.mappings[0]!.syncRecordId,
              last_synced_at: now,
            };
          });
        }),
        sharedContext,
      );

      return { mappings, attributes, values, selections };
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

  @InjectTransactionManager()
  async deleteCatalogProjection(
    projection: CreatedCatalogProjectionIds,
    @MedusaContext() sharedContext: Context = {},
  ): Promise<void> {
    await this.deleteCatalogVariantAttributeValues(projection.selectionIds, sharedContext);
    await this.deleteCatalogAttributeValueMappings(projection.valueIds, sharedContext);
    await this.deleteCatalogAttributeMappings(projection.attributeIds, sharedContext);
    await this.deleteCatalogMappings(projection.mappingIds, sharedContext);
  }

  @InjectTransactionManager()
  async synchronizeCatalogProjection(
    input: SynchronizeCatalogProjectionInput,
    @MedusaContext() sharedContext: Context = {},
  ): Promise<SynchronizedCatalogProjection> {
    const mappingIds = [
      input.template.mappingId,
      ...input.variants.flatMap(({ mappingId }) => mappingId ?? []),
    ];
    const attributeIds = input.attributes.map(({ mappingId }) => mappingId);
    const valueIds = input.attributes.flatMap(({ values }) =>
      values.flatMap(({ mappingId }) => mappingId ?? []),
    );
    const previousMappings = await this.listCatalogMappings(
      { id: mappingIds },
      undefined,
      sharedContext,
    );
    const previousAttributes = attributeIds.length
      ? await this.listCatalogAttributeMappings({ id: attributeIds }, undefined, sharedContext)
      : [];
    const previousValues = valueIds.length
      ? await this.listCatalogAttributeValueMappings({ id: valueIds }, undefined, sharedContext)
      : [];
    const now = new Date();

    const updatedMappings = await this.updateCatalogMappings(
      [
        {
          id: input.template.mappingId,
          source_revision_changed_at: input.sourceRevision.changedAt,
          source_revision_product_id: input.sourceRevision.productId,
          source_fingerprint: input.sourceFingerprint,
          source_label: input.template.sourceLabel,
          archived: input.template.archived,
          last_sync_record_id: input.syncRecordId,
          sync_state: SUCCEEDED,
          last_synced_at: now,
        },
        ...input.variants.flatMap((variant) =>
          variant.mappingId
            ? [
                {
                  id: variant.mappingId,
                  source_revision_changed_at: input.sourceRevision.changedAt,
                  source_revision_product_id: input.sourceRevision.productId,
                  source_fingerprint: input.sourceFingerprint,
                  source_label: variant.sourceLabel,
                  source_internal_reference: variant.sourceInternalReference,
                  source_barcode: variant.sourceBarcode,
                  archived: variant.archived,
                  last_sync_record_id: input.syncRecordId,
                  sync_state: SUCCEEDED,
                  last_synced_at: now,
                },
              ]
            : [],
        ),
      ],
      sharedContext,
    );
    const createdMappings = input.newMappings.length
      ? await this.createCatalogMappings(
          input.newMappings.map((mapping) => ({
            odoo_model: mapping.odooModel,
            odoo_database_id: mapping.odooDatabaseId,
            odoo_integration_key: mapping.odooIntegrationKey,
            source_revision_changed_at: mapping.sourceRevision.changedAt,
            source_revision_product_id: mapping.sourceRevision.productId,
            source_fingerprint: mapping.sourceFingerprint,
            source_label: mapping.sourceLabel,
            source_internal_reference: mapping.sourceInternalReference,
            source_barcode: mapping.sourceBarcode,
            medusa_product_id: mapping.medusaProductId,
            medusa_variant_id: mapping.medusaVariantId,
            last_sync_record_id: mapping.syncRecordId,
            sync_state: SUCCEEDED,
            archived: mapping.archived,
            last_synced_at: now,
          })),
          sharedContext,
        )
      : [];
    const updatedAttributes = attributeIds.length
      ? await this.updateCatalogAttributeMappings(
          input.attributes.map((attribute) => ({
            id: attribute.mappingId,
            source_label: attribute.sourceLabel,
            last_sync_record_id: input.syncRecordId,
            last_synced_at: now,
          })),
          sharedContext,
        )
      : [];
    const updatedValues = valueIds.length
      ? await this.updateCatalogAttributeValueMappings(
          input.attributes.flatMap((attribute) =>
            attribute.values.flatMap((value) =>
              value.mappingId
                ? [
                    {
                      id: value.mappingId,
                      source_label: value.sourceLabel,
                      last_sync_record_id: input.syncRecordId,
                      last_synced_at: now,
                    },
                  ]
                : [],
            ),
          ),
          sharedContext,
        )
      : [];
    const attributeByOdooId = new Map(
      updatedAttributes.map((attribute) => [attribute.odoo_attribute_id, attribute]),
    );
    const newValueInputs = input.attributes.flatMap((attribute) => {
      const attributeMapping = attributeByOdooId.get(attribute.odooAttributeId);
      if (!attributeMapping) {
        throw invalidProjection("A new Catalog value has no attribute mapping.");
      }

      return attribute.values.flatMap((value) =>
        value.mappingId
          ? []
          : [
              {
                catalog_attribute_mapping_id: attributeMapping.id,
                odoo_attribute_value_id: value.odooAttributeValueId,
                odoo_template_attribute_value_id: value.odooTemplateAttributeValueId,
                source_label: value.sourceLabel,
                medusa_product_option_value_id: value.medusaProductOptionValueId,
                last_sync_record_id: input.syncRecordId,
                last_synced_at: now,
              },
            ],
      );
    });
    const createdValues = newValueInputs.length
      ? await this.createCatalogAttributeValueMappings(newValueInputs, sharedContext)
      : [];
    const mappingByIntegrationKey = new Map(
      createdMappings.map((mapping) => [mapping.odoo_integration_key, mapping]),
    );
    const valueBySourceIdentity = new Map(
      [...updatedValues, ...createdValues].map((value) => [
        `${value.catalog_attribute_mapping_id}:${value.odoo_attribute_value_id}`,
        value,
      ]),
    );
    const createdSelections = input.newVariantSelections.length
      ? await this.createCatalogVariantAttributeValues(
          input.newVariantSelections.flatMap((variantSelection) => {
            const variantMapping = mappingByIntegrationKey.get(
              variantSelection.variantIntegrationKey,
            );
            if (!variantMapping) {
              throw invalidProjection("A new Catalog Variant has no mapping.");
            }

            return variantSelection.selections.map((selection) => {
              const attribute = attributeByOdooId.get(selection.odooAttributeId);
              const value = attribute
                ? valueBySourceIdentity.get(`${attribute.id}:${selection.odooAttributeValueId}`)
                : undefined;
              if (!attribute || !value) {
                throw invalidProjection("A new Catalog Variant selection has no mapping.");
              }

              return {
                variant_catalog_mapping_id: variantMapping.id,
                catalog_attribute_mapping_id: attribute.id,
                catalog_attribute_value_mapping_id: value.id,
                last_sync_record_id: input.syncRecordId,
                last_synced_at: now,
              };
            });
          }),
          sharedContext,
        )
      : [];

    return {
      projection: {
        mappings: [...updatedMappings, ...createdMappings],
        attributes: updatedAttributes,
        values: [...updatedValues, ...createdValues],
        selections: createdSelections,
      },
      createdMappingIds: createdMappings.map(({ id }) => id),
      rollback: {
        previousMappings,
        previousAttributes,
        previousValues,
        createdMappingIds: createdMappings.map(({ id }) => id),
        createdValueIds: createdValues.map(({ id }) => id),
        createdSelectionIds: createdSelections.map(({ id }) => id),
      },
    };
  }

  @InjectTransactionManager()
  async restoreCatalogProjection(
    rollback: CatalogProjectionRollback,
    @MedusaContext() sharedContext: Context = {},
  ): Promise<void> {
    if (rollback.createdSelectionIds.length) {
      await this.deleteCatalogVariantAttributeValues(rollback.createdSelectionIds, sharedContext);
    }
    if (rollback.createdValueIds.length) {
      await this.deleteCatalogAttributeValueMappings(rollback.createdValueIds, sharedContext);
    }
    if (rollback.createdMappingIds.length) {
      await this.deleteCatalogMappings(rollback.createdMappingIds, sharedContext);
    }
    if (rollback.previousMappings.length) {
      await this.updateCatalogMappings(rollback.previousMappings, sharedContext);
    }
    if (rollback.previousAttributes.length) {
      await this.updateCatalogAttributeMappings(rollback.previousAttributes, sharedContext);
    }
    if (rollback.previousValues.length) {
      await this.updateCatalogAttributeValueMappings(rollback.previousValues, sharedContext);
    }
  }

  @InjectTransactionManager()
  async completeUnchangedImport(
    input: CompleteUnchangedCatalogImportInput,
    @MedusaContext() sharedContext: Context = {},
  ): Promise<SyncRecordRecord> {
    const now = new Date();
    if (input.projection.mappingIds.length) {
      await this.updateCatalogMappings(
        input.projection.mappingIds.map((id) => ({
          id,
          last_sync_record_id: input.syncRecordId,
          sync_state: SUCCEEDED,
          last_synced_at: now,
        })),
        sharedContext,
      );
    }
    if (input.projection.attributeIds.length) {
      await this.updateCatalogAttributeMappings(
        input.projection.attributeIds.map((id) => ({
          id,
          last_sync_record_id: input.syncRecordId,
          last_synced_at: now,
        })),
        sharedContext,
      );
    }
    if (input.projection.valueIds.length) {
      await this.updateCatalogAttributeValueMappings(
        input.projection.valueIds.map((id) => ({
          id,
          last_sync_record_id: input.syncRecordId,
          last_synced_at: now,
        })),
        sharedContext,
      );
    }
    if (input.projection.selectionIds.length) {
      await this.updateCatalogVariantAttributeValues(
        input.projection.selectionIds.map((id) => ({
          id,
          last_sync_record_id: input.syncRecordId,
          last_synced_at: now,
        })),
        sharedContext,
      );
    }

    return this.completeImport(input, sharedContext);
  }

  async assertCatalogIdentitiesAvailable(
    identities: readonly Readonly<{
      odooModel: "product.product" | "product.template";
      odooIntegrationKey: string;
      odooDatabaseId: number;
    }>[],
  ): Promise<void> {
    const existing = await this.listCatalogMappings({
      $or: [
        { odoo_integration_key: identities.map(({ odooIntegrationKey }) => odooIntegrationKey) },
        ...identities.map(({ odooModel, odooDatabaseId }) => ({
          odoo_model: odooModel,
          odoo_database_id: odooDatabaseId,
        })),
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

  async assertCatalogIdentitiesCompatible(
    identities: readonly Readonly<{
      odooModel: "product.product" | "product.template";
      odooIntegrationKey: string;
      odooDatabaseId: number;
    }>[],
    allowedMappingIds: readonly string[],
  ): Promise<void> {
    const existing = await this.listCatalogMappings({
      $or: [
        { odoo_integration_key: identities.map(({ odooIntegrationKey }) => odooIntegrationKey) },
        ...identities.map(({ odooModel, odooDatabaseId }) => ({
          odoo_model: odooModel,
          odoo_database_id: odooDatabaseId,
        })),
      ],
    });
    const allowed = new Set(allowedMappingIds);
    for (const mapping of existing) {
      const identity = identities.find(
        ({ odooIntegrationKey, odooModel, odooDatabaseId }) =>
          odooIntegrationKey === mapping.odoo_integration_key ||
          (odooModel === mapping.odoo_model && odooDatabaseId === mapping.odoo_database_id),
      );
      if (
        !identity ||
        !allowed.has(mapping.id) ||
        identity.odooIntegrationKey !== mapping.odoo_integration_key ||
        identity.odooModel !== mapping.odoo_model ||
        identity.odooDatabaseId !== mapping.odoo_database_id
      ) {
        throw identityConflict();
      }
    }
  }

  async completeImport(
    input: CompleteCatalogImportInput,
    @MedusaContext() sharedContext: Context = {},
  ): Promise<SyncRecordRecord> {
    return this.updateSyncRecords(
      {
        id: input.syncRecordId,
        response_fingerprint: input.sourceFingerprint,
        state: "succeeded",
        source_template_integration_key: input.templateIntegrationKey,
        source_revision_changed_at: input.sourceRevision.changedAt,
        source_revision_product_id: input.sourceRevision.productId,
        next_cursor_changed_at: input.nextCursor?.changedAt ?? null,
        next_cursor_product_id: input.nextCursor?.productId ?? null,
        medusa_product_id: input.result.productId,
        result: input.result,
        error_type: null,
        error_code: null,
        error_message: null,
        finished_at: new Date(),
        next_attempt_at: null,
      },
      sharedContext,
    );
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

  async #resolveSource(): Promise<CatalogSource> {
    if (this.#source) {
      return this.#source;
    }
    if (this.#sourcePromise) {
      return this.#sourcePromise;
    }

    this.#sourcePromise = createOdooCatalogSource(this.#options.odoo).then((source) => {
      this.#ownedSource = source;
      this.#source = source;
      return source;
    });
    return this.#sourcePromise;
  }
}

export type CatalogSyncModule = Pick<
  CatalogSyncModuleService,
  | "beginImport"
  | "assertCatalogIdentitiesAvailable"
  | "assertCatalogIdentitiesCompatible"
  | "completeImport"
  | "completeUnchangedImport"
  | "createCatalogProjection"
  | "deleteCatalogProjection"
  | "failImport"
  | "findCatalogProjection"
  | "markImportInProgress"
  | "readCatalogBatch"
  | "recordImportSource"
  | "restoreCatalogProjection"
  | "synchronizeCatalogProjection"
>;

type BeginCatalogImportResult = Readonly<{
  record: SyncRecordRecord;
  created: boolean;
}>;

export type CreatedCatalogProjection = Readonly<{
  mappings: CatalogMappingRecord[];
  attributes: CatalogAttributeMappingRecord[];
  values: CatalogAttributeValueMappingRecord[];
  selections: CatalogVariantAttributeValueRecord[];
}>;

export type CreatedCatalogProjectionIds = Readonly<{
  mappingIds: string[];
  attributeIds: string[];
  valueIds: string[];
  selectionIds: string[];
}>;

export type CatalogProjectionRecords = Readonly<{
  template: CatalogMappingRecord;
  mappings: CatalogMappingRecord[];
  attributes: CatalogAttributeMappingRecord[];
  values: CatalogAttributeValueMappingRecord[];
  selections: CatalogVariantAttributeValueRecord[];
}>;

export type SynchronizeCatalogProjectionInput = Readonly<{
  syncRecordId: string;
  sourceFingerprint: string;
  sourceRevision: Readonly<{ changedAt: string; productId: number }>;
  template: Readonly<{ mappingId: string; sourceLabel: string; archived: boolean }>;
  variants: readonly Readonly<{
    mappingId: string | null;
    sourceLabel: string;
    sourceInternalReference: string | null;
    sourceBarcode: string | null;
    archived: boolean;
  }>[];
  attributes: readonly Readonly<{
    mappingId: string;
    odooAttributeId: number;
    sourceLabel: string;
    values: readonly Readonly<{
      mappingId: string | null;
      odooAttributeValueId: number;
      odooTemplateAttributeValueId: number;
      sourceLabel: string;
      medusaProductOptionValueId: string | null;
    }>[];
  }>[];
  newMappings: readonly CreateCatalogProjectionInput["mappings"][number][];
  newVariantSelections: CreateCatalogProjectionInput["variantSelections"];
}>;

export type CatalogProjectionRollback = Readonly<{
  previousMappings: CatalogMappingRecord[];
  previousAttributes: CatalogAttributeMappingRecord[];
  previousValues: CatalogAttributeValueMappingRecord[];
  createdMappingIds: string[];
  createdValueIds: string[];
  createdSelectionIds: string[];
}>;

export type SynchronizedCatalogProjection = Readonly<{
  projection: CreatedCatalogProjection;
  createdMappingIds: string[];
  rollback: CatalogProjectionRollback;
}>;

type CompleteUnchangedCatalogImportInput = CompleteCatalogImportInput &
  Readonly<{
    projection: Readonly<{
      mappingIds: readonly string[];
      attributeIds: readonly string[];
      valueIds: readonly string[];
      selectionIds: readonly string[];
    }>;
  }>;

function requireTemplateMapping(mappings: readonly CatalogMappingRecord[]): CatalogMappingRecord {
  const template = mappings.find(({ odoo_model }) => odoo_model === "product.template");
  if (!template) {
    throw invalidProjection("The Catalog template mapping result is missing.");
  }

  return template;
}

function invalidProjection(message: string): MedusaError {
  return new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    message,
    "catalog_projection_result_invalid",
  );
}

function identityConflict(): MedusaError {
  return new MedusaError(
    MedusaError.Types.CONFLICT,
    "The Odoo Product identity is already mapped to another Medusa Product.",
    "catalog_identity_conflict",
  );
}

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
