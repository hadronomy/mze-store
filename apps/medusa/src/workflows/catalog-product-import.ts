import type { CreateProductWorkflowInputDTO, LinkDefinition } from "@medusajs/framework/types";
import { MedusaError, Modules, ProductStatus } from "@medusajs/framework/utils";
import type { StepExecutionContext } from "@medusajs/framework/workflows-sdk";
import {
  StepResponse,
  WorkflowResponse,
  createStep,
  createWorkflow,
  transform,
  when,
  type WorkflowData,
} from "@medusajs/framework/workflows-sdk";
import type { CatalogAttribute, CatalogItem } from "@mze-store/odoo-bridge";
import {
  createProductsWorkflow,
  createRemoteLinkStep,
  updateProductOptionsWorkflow,
} from "@medusajs/medusa/core-flows";
import {
  isCatalogTemplateUnavailable,
  isCatalogVariantUnavailable,
} from "~/catalog/catalog-projection";
import { CATALOG_SYNC_MODULE } from "~/modules/catalog-sync";
import type {
  CatalogMappingRecord,
  CatalogSyncModule,
  CreatedCatalogProjection,
  CreatedCatalogProjectionIds,
} from "~/modules/catalog-sync/service";
import type {
  CatalogCursor,
  CatalogSynchronizationResult,
  CreateCatalogAttributeInput,
  CreateCatalogMappingInput,
} from "~/modules/catalog-sync/types";

export type PreparedCatalogImport = Readonly<{
  syncRecordId: string;
  item: CatalogItem;
  currencyCode: string;
  sourceFingerprint: string;
  nextCursor: CatalogCursor | null;
}>;

export type CreatedCatalogProduct = CatalogSynchronizationResult;

type CreatedProductOptionValue = Readonly<{ id: string; value: string }>;
type CreatedProductOption = Readonly<{
  id: string;
  title: string;
  values?: readonly CreatedProductOptionValue[];
}>;
type CreatedProductVariant = Readonly<{ id: string }>;
type CreatedProduct = Readonly<{
  id: string;
  options?: readonly CreatedProductOption[];
  variants?: readonly CreatedProductVariant[];
}>;
type NativeProductVariantOptions = Record<string, string>;

type CreateProjectionStepInput = Readonly<{
  prepared: PreparedCatalogImport;
  products: readonly CreatedProduct[];
}>;

type CompleteImportStepInput = CreateProjectionStepInput &
  Readonly<{
    projection: CreatedCatalogProjection;
    links: LinkDefinition[];
  }>;

const CONFIGURATION_OPTION = "Configuration";
const CONFIGURATION_VALUE = "Default";
const HIDDEN_OPTION_METADATA = { mze_hidden: true, mze_source_generated: true } as const;

function toCreateProductInput(prepared: PreparedCatalogImport): CreateProductWorkflowInputDTO[] {
  const projectedAttributes = getProjectedAttributes(prepared.item);
  const options = projectedAttributes.length
    ? projectedAttributes.map((attribute) => ({
        title: attribute.name,
        values: attribute.values.map(({ name }) => name),
        is_exclusive: true,
      }))
    : [
        {
          title: CONFIGURATION_OPTION,
          values: [CONFIGURATION_VALUE],
          is_exclusive: true,
        },
      ];

  return [
    {
      title: prepared.item.template.name,
      description: prepared.item.template.description ?? undefined,
      status: ProductStatus.DRAFT,
      options,
      variants: prepared.item.variants.map((variant) => ({
        title: variant.name,
        sku: variant.internalReference,
        barcode: variant.barcode,
        allow_backorder: false,
        manage_inventory: true,
        options: toVariantOptions(prepared.item, variant.attributeValues),
        prices: [
          {
            amount: variant.price,
            currency_code: prepared.currencyCode,
          },
        ],
      })),
    },
  ];
}

function toVariantOptions(
  item: CatalogItem,
  selections: CatalogItem["variants"][number]["attributeValues"],
): NativeProductVariantOptions {
  const projected = getProjectedAttributes(item);
  if (!projected.length) {
    return {
      [CONFIGURATION_OPTION]: CONFIGURATION_VALUE,
    } satisfies NativeProductVariantOptions;
  }

  const selectionByAttribute = new Map(
    selections.map(({ attributeId, valueId }) => [attributeId, valueId]),
  );
  return Object.fromEntries(
    projected.map((attribute) => {
      const valueId = selectionByAttribute.get(attribute.id);
      const value = attribute.values.find(({ id }) => id === valueId);
      if (!value) {
        throw sourceRejected(
          `Odoo Variant is missing a value for projected attribute ${attribute.id}.`,
        );
      }

      return [attribute.name, value.name];
    }),
  );
}

async function createCatalogProjection(
  { prepared, products }: CreateProjectionStepInput,
  { container }: StepExecutionContext,
): Promise<StepResponse<CreatedCatalogProjection, CreatedCatalogProjectionIds>> {
  const product = requireOnlyProduct(products);
  const productVariants = requireProductVariants(product, prepared.item.variants.length);
  const templateInput = toTemplateMappingInput(prepared, product.id);
  const variantInputs = prepared.item.variants.map((variant, index) =>
    toVariantMappingInput(prepared, product.id, productVariants[index]!.id, variant),
  );
  const attributes = toCatalogAttributes(prepared.item, product);
  const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  const projection = await catalogSync.createCatalogProjection({
    mappings: [templateInput, ...variantInputs],
    attributes,
    variantSelections: prepared.item.variants.map((variant) => ({
      variantIntegrationKey: variant.integrationKey,
      selections: variant.attributeValues.map(({ attributeId, valueId }) => ({
        odooAttributeId: attributeId,
        odooAttributeValueId: valueId,
      })),
    })),
  });

  return new StepResponse(projection, {
    mappingIds: projection.mappings.map(({ id }) => id),
    attributeIds: projection.attributes.map(({ id }) => id),
    valueIds: projection.values.map(({ id }) => id),
    selectionIds: projection.selections.map(({ id }) => id),
  });
}

async function compensateCatalogProjection(
  ids: CreatedCatalogProjectionIds | undefined,
  { container }: StepExecutionContext,
): Promise<void> {
  if (!ids) {
    return;
  }

  const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  await catalogSync.deleteCatalogProjection(ids);
}

function toTemplateMappingInput(
  prepared: PreparedCatalogImport,
  productId: string,
): CreateCatalogMappingInput {
  return {
    ...mappingCommon(prepared, productId),
    odooModel: prepared.item.template.model,
    odooDatabaseId: prepared.item.template.id,
    odooIntegrationKey: prepared.item.template.integrationKey,
    sourceLabel: prepared.item.template.name,
    sourceInternalReference: null,
    sourceBarcode: null,
    medusaVariantId: null,
    archived: isCatalogTemplateUnavailable(prepared.item.template),
  };
}

function toVariantMappingInput(
  prepared: PreparedCatalogImport,
  productId: string,
  variantId: string,
  variant: CatalogItem["variants"][number],
): CreateCatalogMappingInput {
  return {
    ...mappingCommon(prepared, productId),
    odooModel: variant.model,
    odooDatabaseId: variant.id,
    odooIntegrationKey: variant.integrationKey,
    sourceLabel: variant.name,
    sourceInternalReference: variant.internalReference,
    sourceBarcode: variant.barcode,
    medusaVariantId: variantId,
    archived: isCatalogVariantUnavailable(prepared.item, variant),
  };
}

function mappingCommon(prepared: PreparedCatalogImport, productId: string) {
  return {
    sourceRevision: prepared.item.sourceRevision,
    sourceFingerprint: prepared.sourceFingerprint,
    medusaProductId: productId,
    syncRecordId: prepared.syncRecordId,
  } as const;
}

function toCatalogAttributes(
  item: CatalogItem,
  product: CreatedProduct,
): CreateCatalogAttributeInput[] {
  return item.template.attributes.map((attribute) => {
    if (attribute.variantCreationMode === "never") {
      return {
        odooAttributeId: attribute.id,
        variantCreationMode: attribute.variantCreationMode,
        sourceLabel: attribute.name,
        medusaProductOptionId: null,
        values: attribute.values.map((value) => ({
          odooAttributeValueId: value.id,
          odooTemplateAttributeValueId: value.templateValueId,
          sourceLabel: value.name,
          medusaProductOptionValueId: null,
        })),
      };
    }

    const option = requireProductOption(product, attribute);
    return {
      odooAttributeId: attribute.id,
      variantCreationMode: attribute.variantCreationMode,
      sourceLabel: attribute.name,
      medusaProductOptionId: option.id,
      values: attribute.values.map((value) => ({
        odooAttributeValueId: value.id,
        odooTemplateAttributeValueId: value.templateValueId,
        sourceLabel: value.name,
        medusaProductOptionValueId: requireProductOptionValue(option, value.name).id,
      })),
    };
  });
}

function requireProductOption(
  product: CreatedProduct,
  attribute: CatalogAttribute,
): CreatedProductOption {
  const option = product.options?.find(({ title }) => title === attribute.name);
  if (!option) {
    throw invalidResult(`The Product workflow did not return option ${attribute.name}.`);
  }

  return option;
}

function requireProductOptionValue(
  option: CreatedProductOption,
  sourceLabel: string,
): CreatedProductOptionValue {
  const value = option.values?.find(({ value }) => value === sourceLabel);
  if (!value) {
    throw invalidResult(
      `The Product workflow did not return value ${sourceLabel} for option ${option.title}.`,
    );
  }

  return value;
}

function toHiddenOptionIds(input: {
  products: readonly CreatedProduct[];
  prepared: PreparedCatalogImport;
}) {
  const product = requireOnlyProduct(input.products);
  const projectedAttributes = getProjectedAttributes(input.prepared.item);
  const hiddenTitles = projectedAttributes.length
    ? new Set(
        projectedAttributes
          .filter(({ variantCreationMode }) => variantCreationMode === "dynamic")
          .map(({ name }) => name),
      )
    : new Set([CONFIGURATION_OPTION]);

  return (product.options ?? []).filter(({ title }) => hiddenTitles.has(title)).map(({ id }) => id);
}

function toLinkDefinitions(input: { projection: CreatedCatalogProjection }): LinkDefinition[] {
  return input.projection.mappings.map((mapping) =>
    mapping.odoo_model === "product.template"
      ? {
          [Modules.PRODUCT]: { product_id: mapping.medusa_product_id },
          [CATALOG_SYNC_MODULE]: { catalog_mapping_id: mapping.id },
        }
      : {
          [Modules.PRODUCT]: { product_variant_id: mapping.medusa_variant_id! },
          [CATALOG_SYNC_MODULE]: { catalog_mapping_id: mapping.id },
        },
  );
}

async function completeCatalogImport(
  { prepared, products, projection }: CompleteImportStepInput,
  { container }: StepExecutionContext,
): Promise<StepResponse<CreatedCatalogProduct>> {
  const product = requireOnlyProduct(products);
  const variantMappings = projection.mappings.filter(
    (mapping) => mapping.odoo_model === "product.product",
  );
  const mappingByIntegrationKey = new Map(
    variantMappings.map((mapping) => [mapping.odoo_integration_key, mapping]),
  );
  const result: CreatedCatalogProduct = {
    syncRecordId: prepared.syncRecordId,
    productId: product.id,
    templateCatalogMappingId: requireTemplateMapping(projection.mappings).id,
    variants: prepared.item.variants.map((variant) => {
      const mapping = mappingByIntegrationKey.get(variant.integrationKey);
      if (!mapping?.medusa_variant_id) {
        throw invalidResult(`The Catalog Mapping is missing Odoo Variant ${variant.id}.`);
      }

      return {
        integrationKey: variant.integrationKey,
        odooVariantId: variant.id,
        medusaVariantId: mapping.medusa_variant_id,
        catalogMappingId: mapping.id,
        disposition: "created",
        availability: isCatalogVariantUnavailable(prepared.item, variant)
          ? "unavailable"
          : "available",
      };
    }),
    sourceRevision: prepared.item.sourceRevision,
    nextCursor: prepared.nextCursor,
  };
  const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  await catalogSync.completeImport({
    syncRecordId: prepared.syncRecordId,
    templateIntegrationKey: prepared.item.template.integrationKey,
    sourceFingerprint: prepared.sourceFingerprint,
    sourceRevision: prepared.item.sourceRevision,
    nextCursor: prepared.nextCursor,
    result,
  });

  return new StepResponse(result);
}

function composeCatalogProductImport(input: WorkflowData<PreparedCatalogImport>) {
  const productsInput = transform(input, toCreateProductInput);
  const products = createProductsWorkflow.runAsStep({ input: { products: productsInput } });
  const hiddenOptionIds = transform({ products, prepared: input }, toHiddenOptionIds);
  when(
    "catalog-product-has-hidden-options",
    { hiddenOptionIds },
    ({ hiddenOptionIds }) => hiddenOptionIds.length > 0,
  ).then(() => {
    updateProductOptionsWorkflow.runAsStep({
      input: {
        selector: { id: hiddenOptionIds },
        update: { metadata: HIDDEN_OPTION_METADATA },
      },
    });
  });
  const projection = createCatalogProjectionStep({ prepared: input, products });
  const links = transform({ projection }, toLinkDefinitions);
  const createdLinks = createRemoteLinkStep(links).config({
    name: "create-catalog-product-mapping-links",
  });
  const completed = completeCatalogImportStep({
    prepared: input,
    products,
    projection,
    links: createdLinks,
  });

  return new WorkflowResponse(completed);
}

function getProjectedAttributes(item: CatalogItem): readonly CatalogAttribute[] {
  return item.template.attributes.filter(
    ({ variantCreationMode }) => variantCreationMode !== "never",
  );
}

function requireOnlyProduct(products: readonly CreatedProduct[]): CreatedProduct {
  const [product] = products;
  if (!product || products.length !== 1) {
    throw invalidResult("The Product workflow must return one Product.");
  }

  return product;
}

function requireProductVariants(
  product: CreatedProduct,
  expectedCount: number,
): readonly CreatedProductVariant[] {
  const variants = product.variants ?? [];
  if (variants.length !== expectedCount) {
    throw invalidResult(`The Product workflow must return ${expectedCount} Variants.`);
  }

  return variants;
}

function requireTemplateMapping(mappings: readonly CatalogMappingRecord[]): CatalogMappingRecord {
  const mapping = mappings.find(({ odoo_model }) => odoo_model === "product.template");
  if (!mapping) {
    throw invalidResult("The Catalog template mapping result is missing.");
  }

  return mapping;
}

function invalidResult(message: string): MedusaError {
  return new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    message,
    "catalog_projection_result_invalid",
  );
}

function sourceRejected(message: string): MedusaError {
  return new MedusaError(MedusaError.Types.INVALID_DATA, message, "catalog_source_rejected");
}

const createCatalogProjectionStep = createStep(
  "create-catalog-projection",
  createCatalogProjection,
  compensateCatalogProjection,
);

const completeCatalogImportStep = createStep("complete-catalog-import", completeCatalogImport);

export const createCatalogProductWorkflow = createWorkflow(
  "create-catalog-product",
  composeCatalogProductImport,
);
