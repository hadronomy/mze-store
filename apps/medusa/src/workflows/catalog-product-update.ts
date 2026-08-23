import type { IProductModuleService, LinkDefinition } from "@medusajs/framework/types";
import { MedusaError, Modules } from "@medusajs/framework/utils";
import type { StepExecutionContext } from "@medusajs/framework/workflows-sdk";
import {
  StepResponse,
  WorkflowResponse,
  createStep,
  createWorkflow,
  transform,
  type WorkflowData,
} from "@medusajs/framework/workflows-sdk";
import {
  createProductVariantsWorkflow,
  createRemoteLinkStep,
  updateProductVariantsWorkflow,
} from "@medusajs/medusa/core-flows";
import {
  isCatalogTemplateUnavailable,
  isCatalogVariantUnavailable,
} from "~/catalog/catalog-projection";
import {
  CATALOG_SYNC_MODULE,
  catalogError,
  type CatalogProjectionMappingRef,
  type CatalogProjectionReceipt,
  type CatalogSyncModule,
  type UpdateCatalogProjectionChange,
  type UpdateCatalogValueChange,
} from "~/modules/catalog-sync";
import type {
  CatalogProjectionRecords,
  CatalogSynchronizationResult,
} from "~/modules/catalog-sync";
import type { PreparedCatalogImport } from "./catalog-product-import";

export type CurrentCatalogProduct = Readonly<{
  id: string;
  options: readonly Readonly<{
    id: string;
    title: string;
    values: readonly Readonly<{ id: string; value: string }>[];
  }>[];
}>;

export type PreparedCatalogUpdate = PreparedCatalogImport &
  Readonly<{
    existing: CatalogProjectionRecords;
    product: CurrentCatalogProduct;
  }>;

type CreatedVariant = Readonly<{ id: string }>;

type CatalogOptionValueAddition = Readonly<{
  attributeMappingId: string;
  odooAttributeId: number;
  odooAttributeValueId: number;
  odooTemplateAttributeValueId: number;
  sourceLabel: string;
  medusaProductOptionValueId: string;
  optionValue: string;
}>;

type ExtendCatalogProductOptionsResult = Readonly<{
  additions: readonly CatalogOptionValueAddition[];
}>;

type ExtendCatalogProductOptionsRollback = Readonly<{
  updates: readonly Readonly<{
    productId: string;
    optionId: string;
    valueIds: readonly string[];
  }>[];
}>;

type SynchronizeProjectionStepInput = Readonly<{
  prepared: PreparedCatalogUpdate;
  createdVariants: readonly CreatedVariant[];
  extendedOptions: ExtendCatalogProductOptionsResult;
}>;

type SynchronizeProjectionStepResult = Readonly<{
  mappings: readonly CatalogProjectionMappingRef[];
  createdMappingIds: readonly string[];
}>;

type CompleteUpdateStepInput = SynchronizeProjectionStepInput &
  Readonly<{
    synchronized: SynchronizeProjectionStepResult;
    links: LinkDefinition[];
  }>;

function toExistingVariantUpdates(prepared: PreparedCatalogUpdate) {
  const mappingByIntegrationKey = variantMappingByIntegrationKey(prepared.existing);
  return {
    product_variants: prepared.item.variants.flatMap((variant) => {
      const mapping = mappingByIntegrationKey.get(variant.integrationKey);
      if (!mapping?.medusa_variant_id) {
        return [];
      }

      return [
        {
          id: mapping.medusa_variant_id,
          sku: variant.internalReference,
          barcode: variant.barcode,
          prices: [
            {
              amount: variant.price,
              currency_code: prepared.currencyCode,
            },
          ],
        },
      ];
    }),
  };
}

function toNewVariantCreates(input: {
  prepared: PreparedCatalogUpdate;
  extendedOptions: ExtendCatalogProductOptionsResult;
}) {
  const { prepared, extendedOptions } = input;
  const mappingByIntegrationKey = variantMappingByIntegrationKey(prepared.existing);
  return {
    product_variants: prepared.item.variants.flatMap((variant) => {
      if (mappingByIntegrationKey.has(variant.integrationKey)) {
        return [];
      }

      return [
        {
          product_id: prepared.existing.template.medusa_product_id,
          title: variant.name,
          sku: variant.internalReference,
          barcode: variant.barcode,
          allow_backorder: false,
          manage_inventory: true,
          options: toCurrentVariantOptions(
            prepared,
            extendedOptions.additions,
            variant.attributeValues,
          ),
          prices: [
            {
              amount: variant.price,
              currency_code: prepared.currencyCode,
            },
          ],
        },
      ];
    }),
  };
}

function toCurrentVariantOptions(
  prepared: PreparedCatalogUpdate,
  additions: readonly CatalogOptionValueAddition[],
  selections: PreparedCatalogUpdate["item"]["variants"][number]["attributeValues"],
): Record<string, string> {
  const selectionByAttributeId = new Map<number, number>(
    selections.map(({ attributeId, valueId }) => [attributeId, valueId]),
  );
  const currentOptionById = new Map(prepared.product.options.map((option) => [option.id, option]));
  const valueMappingsByAttribute = new Map(
    prepared.existing.attributes.map((attribute) => [
      attribute.id,
      prepared.existing.values.filter(
        ({ catalog_attribute_mapping_id }) => catalog_attribute_mapping_id === attribute.id,
      ),
    ]),
  );

  return Object.fromEntries(
    prepared.existing.attributes.flatMap((attribute) => {
      if (attribute.variant_creation_mode === "never") {
        return [];
      }
      if (!attribute.medusa_product_option_id) {
        throw projectionInvalid("A projected Catalog attribute has no Product Option mapping.");
      }

      const option = currentOptionById.get(attribute.medusa_product_option_id);
      const sourceValueId = selectionByAttributeId.get(attribute.odoo_attribute_id);
      const valueMapping = valueMappingsByAttribute
        .get(attribute.id)
        ?.find(({ odoo_attribute_value_id }) => odoo_attribute_value_id === sourceValueId);
      const existingValue = option?.values.find(
        ({ id }) => id === valueMapping?.medusa_product_option_value_id,
      );
      const addedValue = additions.find(
        (addition) =>
          addition.attributeMappingId === attribute.id &&
          addition.odooAttributeValueId === sourceValueId,
      );
      const value = existingValue?.value ?? addedValue?.optionValue;
      if (!option || !value) {
        throw projectionInvalid("A projected Catalog value has no Product Option Value mapping.");
      }

      return [[option.title, value]];
    }),
  );
}

async function extendCatalogProductOptions(
  prepared: PreparedCatalogUpdate,
  { container }: StepExecutionContext,
): Promise<StepResponse<ExtendCatalogProductOptionsResult, ExtendCatalogProductOptionsRollback>> {
  const productModule = container.resolve<IProductModuleService>(Modules.PRODUCT);
  const appliedUpdates: { productId: string; optionId: string; valueIds: string[] }[] = [];
  const additions: CatalogOptionValueAddition[] = [];

  try {
    for (const sourceAttribute of prepared.item.template.attributes) {
      if (sourceAttribute.variantCreationMode === "never") {
        continue;
      }
      const attributeMapping = prepared.existing.attributes.find(
        ({ odoo_attribute_id }) => odoo_attribute_id === sourceAttribute.id,
      );
      if (!attributeMapping?.medusa_product_option_id) {
        throw projectionInvalid("A projected Catalog attribute has no Product Option mapping.");
      }

      const mappedValueIds = new Set(
        prepared.existing.values
          .filter(
            ({ catalog_attribute_mapping_id }) =>
              catalog_attribute_mapping_id === attributeMapping.id,
          )
          .map(({ odoo_attribute_value_id }) => odoo_attribute_value_id),
      );
      const newSourceValues = sourceAttribute.values.filter(({ id }) => !mappedValueIds.has(id));
      if (!newSourceValues.length) {
        continue;
      }

      const option = prepared.product.options.find(
        ({ id }) => id === attributeMapping.medusa_product_option_id,
      );
      if (!option) {
        throw projectionInvalid("A projected Catalog Product Option could not be loaded.");
      }
      const currentLabels = option.values.map(({ value }) => value);
      const currentLabelSet = new Set(currentLabels);
      const conflicting = newSourceValues.find(({ name }) => currentLabelSet.has(name));
      if (conflicting) {
        throw structureConflict(
          `New Odoo value ${sourceAttribute.id}:${conflicting.id} conflicts with an existing Product Option Value label.`,
        );
      }

      const previousValueIds = new Set(option.values.map(({ id }) => id));
      await productModule.updateProductOptionValuesOnProduct({
        product_id: prepared.product.id,
        product_option_id: option.id,
        add: newSourceValues.map(({ name: value }) => ({ value })),
      });
      const updatedOption = await productModule.retrieveProductOption(option.id, {
        relations: ["values"],
      });
      appliedUpdates.push({
        productId: prepared.product.id,
        optionId: option.id,
        valueIds:
          updatedOption.values?.filter(({ id }) => !previousValueIds.has(id)).map(({ id }) => id) ??
          [],
      });

      for (const sourceValue of newSourceValues) {
        const productOptionValue = updatedOption.values?.find(
          ({ value }) => value === sourceValue.name,
        );
        if (!productOptionValue) {
          throw projectionInvalid(
            `The Product Option did not return new Odoo value ${sourceAttribute.id}:${sourceValue.id}.`,
          );
        }
        additions.push({
          attributeMappingId: attributeMapping.id,
          odooAttributeId: sourceAttribute.id,
          odooAttributeValueId: sourceValue.id,
          odooTemplateAttributeValueId: sourceValue.templateValueId,
          sourceLabel: sourceValue.name,
          medusaProductOptionValueId: productOptionValue.id,
          optionValue: productOptionValue.value,
        });
      }
    }
  } catch (thrown) {
    await restoreProductOptionValues(productModule, appliedUpdates);
    throw thrown;
  }

  return new StepResponse(
    { additions },
    {
      updates: appliedUpdates,
    },
  );
}

async function restoreCatalogProductOptions(
  rollback: ExtendCatalogProductOptionsRollback | undefined,
  { container }: StepExecutionContext,
): Promise<void> {
  if (!rollback?.updates.length) {
    return;
  }

  const productModule = container.resolve<IProductModuleService>(Modules.PRODUCT);
  await restoreProductOptionValues(productModule, rollback.updates);
}

async function restoreProductOptionValues(
  productModule: IProductModuleService,
  updates: readonly Readonly<{
    productId: string;
    optionId: string;
    valueIds: readonly string[];
  }>[],
): Promise<void> {
  for (const update of [...updates].reverse()) {
    if (!update.valueIds.length) {
      continue;
    }
    await productModule.updateProductOptionValuesOnProduct({
      product_id: update.productId,
      product_option_id: update.optionId,
      remove: [...update.valueIds],
    });
    await productModule.deleteProductOptionValues([...update.valueIds]);
  }
}

async function synchronizeProjection(
  { prepared, createdVariants, extendedOptions }: SynchronizeProjectionStepInput,
  { container }: StepExecutionContext,
): Promise<StepResponse<SynchronizeProjectionStepResult, CatalogProjectionReceipt>> {
  const existingByIntegrationKey = variantMappingByIntegrationKey(prepared.existing);
  const createdVariantIdByKey = new Map<string, string>();
  for (const variant of prepared.item.variants) {
    if (existingByIntegrationKey.has(variant.integrationKey)) {
      continue;
    }
    const created = createdVariants[createdVariantIdByKey.size];
    if (!created) {
      throw projectionInvalid("The Variant workflow returned fewer Variants than expected.");
    }
    createdVariantIdByKey.set(variant.integrationKey, created.id);
  }
  if (createdVariantIdByKey.size !== createdVariants.length) {
    throw projectionInvalid("The Variant workflow returned an unexpected number of new Variants.");
  }

  const newIndexByIntegrationKey = new Map<string, number>();
  const variants: UpdateCatalogProjectionChange["variants"] = prepared.item.variants.map(
    (variant, index) => {
      const mapping = existingByIntegrationKey.get(variant.integrationKey);
      if (mapping) {
        return {
          kind: "existing" as const,
          mappingId: mapping.id,
          sourceLabel: variant.name,
          sourceInternalReference: variant.internalReference,
          sourceBarcode: variant.barcode,
          archived: isCatalogVariantUnavailable(prepared.item, variant),
        };
      }

      newIndexByIntegrationKey.set(variant.integrationKey, index);
      return {
        kind: "new" as const,
        odooModel: variant.model,
        odooDatabaseId: variant.id,
        odooIntegrationKey: variant.integrationKey,
        sourceLabel: variant.name,
        sourceInternalReference: variant.internalReference,
        sourceBarcode: variant.barcode,
        medusaProductId: prepared.existing.template.medusa_product_id,
        medusaVariantId: createdVariantIdByKey.get(variant.integrationKey)!,
        archived: isCatalogVariantUnavailable(prepared.item, variant),
      };
    },
  );

  const attributes: UpdateCatalogProjectionChange["attributes"] =
    prepared.item.template.attributes.map((attribute) => {
      const mapping = prepared.existing.attributes.find(
        ({ odoo_attribute_id }) => odoo_attribute_id === attribute.id,
      );
      if (!mapping) {
        throw projectionInvalid("A source attribute has no Catalog Attribute Mapping.");
      }

      const values: UpdateCatalogValueChange[] = attribute.values.map((value) => {
        const valueMapping = prepared.existing.values.find(
          (candidate) =>
            candidate.catalog_attribute_mapping_id === mapping.id &&
            candidate.odoo_attribute_value_id === value.id,
        );
        if (valueMapping) {
          return {
            kind: "existing" as const,
            mappingId: valueMapping.id,
            sourceLabel: value.name,
          };
        }

        const addition = extendedOptions.additions.find(
          (candidate) =>
            candidate.attributeMappingId === mapping.id &&
            candidate.odooAttributeValueId === value.id,
        );
        if (addition) {
          return {
            kind: "new" as const,
            odooAttributeValueId: value.id,
            odooTemplateAttributeValueId: value.templateValueId,
            sourceLabel: value.name,
            medusaProductOptionValueId: addition.medusaProductOptionValueId,
          };
        }
        if (attribute.variantCreationMode !== "never") {
          throw projectionInvalid("A projected source value has no Product Option Value mapping.");
        }

        return {
          kind: "new" as const,
          odooAttributeValueId: value.id,
          odooTemplateAttributeValueId: value.templateValueId,
          sourceLabel: value.name,
          medusaProductOptionValueId: null,
        };
      });

      return {
        mappingId: mapping.id,
        odooAttributeId: attribute.id,
        sourceLabel: attribute.name,
        values,
      };
    });

  const change: UpdateCatalogProjectionChange = {
    tag: "update",
    syncRecordId: prepared.syncRecordId,
    sourceFingerprint: prepared.sourceFingerprint,
    sourceRevision: prepared.item.sourceRevision,
    template: {
      mappingId: prepared.existing.template.id,
      sourceLabel: prepared.item.template.name,
      archived: isCatalogTemplateUnavailable(prepared.item.template),
    },
    variants,
    attributes,
    newVariantSelections: prepared.item.variants.flatMap((variant, index) => {
      if (!newIndexByIntegrationKey.has(variant.integrationKey)) {
        return [];
      }

      return [
        {
          variantIndex: index,
          selections: variant.attributeValues.map(({ attributeId, valueId }) => ({
            odooAttributeId: attributeId,
            odooAttributeValueId: valueId,
          })),
        },
      ];
    }),
  };

  const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  const commit = await catalogSync.commitProjection(change);

  return new StepResponse(
    {
      mappings: commit.mappings,
      createdMappingIds: commit.receipt.createdMappingIds,
    },
    commit.receipt,
  );
}

async function revertSynchronizedProjection(
  rollback: CatalogProjectionReceipt | undefined,
  { container }: StepExecutionContext,
): Promise<void> {
  if (!rollback) {
    return;
  }

  const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  await catalogSync.revertProjection(rollback);
}

function toNewLinkDefinitions(input: {
  synchronized: SynchronizeProjectionStepResult;
}): LinkDefinition[] {
  const created = new Set(input.synchronized.createdMappingIds);
  return input.synchronized.mappings.flatMap((mapping) => {
    if (!created.has(mapping.id) || !mapping.medusaVariantId) {
      return [];
    }

    return [
      {
        [Modules.PRODUCT]: { product_variant_id: mapping.medusaVariantId },
        [CATALOG_SYNC_MODULE]: { catalog_mapping_id: mapping.id },
      },
    ];
  });
}

async function completeUpdate({
  prepared,
  synchronized,
}: CompleteUpdateStepInput): Promise<StepResponse<CatalogSynchronizationResult>> {
  const refByIntegrationKey = new Map(
    synchronized.mappings
      .filter(({ odooModel }) => odooModel === "product.product")
      .map((ref) => [ref.odooIntegrationKey, ref]),
  );
  const previousByIntegrationKey = variantMappingByIntegrationKey(prepared.existing);

  const variants = prepared.item.variants.map((variant) => {
    const ref = requireRow(refByIntegrationKey.get(variant.integrationKey));
    const medusaVariantId = requireRow(ref.medusaVariantId);

    const previous = previousByIntegrationKey.get(variant.integrationKey);
    const archived = isCatalogVariantUnavailable(prepared.item, variant);
    const disposition = !previous
      ? ("created" as const)
      : !previous.archived && archived
        ? ("archived" as const)
        : previous.archived && !archived
          ? ("reactivated" as const)
          : ("updated" as const);

    return {
      integrationKey: variant.integrationKey,
      odooVariantId: variant.id,
      medusaVariantId,
      catalogMappingId: ref.id,
      disposition,
      availability: archived ? ("unavailable" as const) : ("available" as const),
    };
  });

  const result: CatalogSynchronizationResult = {
    syncRecordId: prepared.syncRecordId,
    productId: prepared.existing.template.medusa_product_id,
    templateCatalogMappingId: prepared.existing.template.id,
    templateIntegrationKey: prepared.item.template.integrationKey,
    variants,
    sourceRevision: prepared.item.sourceRevision,
    nextCursor: prepared.nextCursor,
  };

  // The orchestrator owns the Sync Record lifecycle; this step only produces
  // the durable result it will store.
  return new StepResponse(result);
}

function composeCatalogProductUpdate(input: WorkflowData<PreparedCatalogUpdate>) {
  const extendedOptions = extendCatalogProductOptionsStep(input);
  const existingVariantUpdates = transform({ prepared: input, extendedOptions }, ({ prepared }) =>
    toExistingVariantUpdates(prepared),
  );
  const updatedVariants = updateProductVariantsWorkflow.runAsStep({
    input: existingVariantUpdates,
  });
  const newVariantCreates = transform(
    { prepared: input, extendedOptions, updatedVariants },
    ({ prepared, extendedOptions }) => toNewVariantCreates({ prepared, extendedOptions }),
  );
  const createdVariants = createProductVariantsWorkflow.runAsStep({ input: newVariantCreates });
  const synchronized = synchronizeProjectionStep({
    prepared: input,
    createdVariants,
    extendedOptions,
  });
  const links = transform({ synchronized }, toNewLinkDefinitions);
  const createdLinks = createRemoteLinkStep(links).config({
    name: "create-new-catalog-variant-mapping-links",
  });
  const completed = completeUpdateStep({
    prepared: input,
    createdVariants,
    extendedOptions,
    synchronized,
    links: createdLinks,
  });

  return new WorkflowResponse(completed);
}

function variantMappingByIntegrationKey(existing: CatalogProjectionRecords) {
  return new Map(
    existing.mappings
      .filter(({ odoo_model }) => odoo_model === "product.product")
      .map((mapping) => [mapping.odoo_integration_key, mapping]),
  );
}

function requireRow<Value>(value: Value | undefined | null, message?: string): Value {
  if (!value) {
    throw projectionInvalid(message ?? "The Catalog projection result is incomplete.");
  }

  return value;
}

function projectionInvalid(message: string): MedusaError {
  return catalogError("catalog_projection_result_invalid", message);
}

function structureConflict(message: string): MedusaError {
  return catalogError("catalog_structure_conflict", message);
}

const synchronizeProjectionStep = createStep(
  "synchronize-catalog-projection",
  synchronizeProjection,
  revertSynchronizedProjection,
);

const extendCatalogProductOptionsStep = createStep(
  "extend-catalog-product-options",
  extendCatalogProductOptions,
  restoreCatalogProductOptions,
);

const completeUpdateStep = createStep("complete-catalog-update", completeUpdate);

export const updateCatalogProductWorkflow = createWorkflow(
  "update-catalog-product",
  composeCatalogProductUpdate,
);
