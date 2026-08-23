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
import type { CatalogAttribute, CatalogItem, SourceRevision } from "@mze-store/odoo-bridge";
import {
  createProductsWorkflow,
  createRemoteLinkStep,
  updateProductOptionsWorkflow,
} from "@medusajs/medusa/core-flows";
import {
  isCatalogTemplateUnavailable,
  isCatalogVariantUnavailable,
} from "~/catalog/catalog-projection";
import {
  CATALOG_SYNC_MODULE,
  catalogError,
  type CatalogMappingSeed,
  type CatalogProjectionMappingRef,
  type CatalogProjectionReceipt,
  type CatalogSyncModule,
} from "~/modules/catalog-sync";
import type { CatalogSynchronizationResult } from "~/modules/catalog-sync";

export type PreparedCatalogImport = Readonly<{
  syncRecordId: string;
  item: CatalogItem;
  currencyCode: string;
  sourceFingerprint: string;
  nextCursor: SourceRevision | null;
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
    mappings: readonly CatalogProjectionMappingRef[];
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

async function createProjection(
  { prepared, products }: CreateProjectionStepInput,
  { container }: StepExecutionContext,
): Promise<StepResponse<readonly CatalogProjectionMappingRef[], CatalogProjectionReceipt>> {
  const product = requireOnlyProduct(products);
  const productVariants = requireProductVariants(product, prepared.item.variants.length);
  const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  const commit = await catalogSync.commitProjection({
    tag: "create",
    syncRecordId: prepared.syncRecordId,
    sourceFingerprint: prepared.sourceFingerprint,
    sourceRevision: prepared.item.sourceRevision,
    template: toTemplateSeed(prepared, product.id),
    variants: prepared.item.variants.map((variant, index) =>
      toVariantSeed(prepared, product.id, productVariants[index]!.id, variant),
    ),
    attributes: toAttributeSeeds(prepared.item, product),
    variantSelections: prepared.item.variants.map((variant, index) => ({
      variantIndex: index,
      selections: variant.attributeValues.map(({ attributeId, valueId }) => ({
        odooAttributeId: attributeId,
        odooAttributeValueId: valueId,
      })),
    })),
  });

  return new StepResponse(commit.mappings, commit.receipt);
}

async function revertProjection(
  receipt: CatalogProjectionReceipt | undefined,
  { container }: StepExecutionContext,
): Promise<void> {
  if (!receipt) {
    return;
  }

  const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  await catalogSync.revertProjection(receipt);
}

function toTemplateSeed(prepared: PreparedCatalogImport, productId: string): CatalogMappingSeed {
  return {
    odooModel: prepared.item.template.model,
    odooDatabaseId: prepared.item.template.id,
    odooIntegrationKey: prepared.item.template.integrationKey,
    sourceLabel: prepared.item.template.name,
    sourceInternalReference: null,
    sourceBarcode: null,
    medusaProductId: productId,
    medusaVariantId: null,
    archived: isCatalogTemplateUnavailable(prepared.item.template),
  };
}

function toVariantSeed(
  prepared: PreparedCatalogImport,
  productId: string,
  variantId: string,
  variant: CatalogItem["variants"][number],
): CatalogMappingSeed {
  return {
    odooModel: variant.model,
    odooDatabaseId: variant.id,
    odooIntegrationKey: variant.integrationKey,
    sourceLabel: variant.name,
    sourceInternalReference: variant.internalReference,
    sourceBarcode: variant.barcode,
    medusaProductId: productId,
    medusaVariantId: variantId,
    archived: isCatalogVariantUnavailable(prepared.item, variant),
  };
}

function toAttributeSeeds(item: CatalogItem, product: CreatedProduct) {
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

function toLinkDefinitions(input: {
  mappings: readonly CatalogProjectionMappingRef[];
}): LinkDefinition[] {
  return input.mappings.map((mapping) => {
    if (mapping.odooModel === "product.template") {
      return {
        [Modules.PRODUCT]: { product_id: mapping.medusaProductId },
        [CATALOG_SYNC_MODULE]: { catalog_mapping_id: mapping.id },
      };
    }

    if (!mapping.medusaVariantId) {
      throw invalidResult(`The Catalog Mapping for Odoo Variant is missing its Medusa Variant.`);
    }

    return {
      [Modules.PRODUCT]: { product_variant_id: mapping.medusaVariantId },
      [CATALOG_SYNC_MODULE]: { catalog_mapping_id: mapping.id },
    };
  });
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
  const mappings = createProjectionStep({ prepared: input, products });
  const links = transform({ mappings }, toLinkDefinitions);
  const createdLinks = createRemoteLinkStep(links).config({
    name: "create-catalog-product-mapping-links",
  });
  const completed = completeImportStep({
    prepared: input,
    products,
    mappings,
    links: createdLinks,
  });

  return new WorkflowResponse(completed);
}

async function completeImport({
  prepared,
  products,
  mappings,
}: CompleteImportStepInput): Promise<StepResponse<CreatedCatalogProduct>> {
  const product = requireOnlyProduct(products);
  const templateRef = requireRow(
    mappings.find(({ odooModel }) => odooModel === "product.template"),
  );
  const variantRefByKey = new Map(
    mappings
      .filter(({ odooModel }) => odooModel === "product.product")
      .map((ref) => [ref.odooIntegrationKey, ref]),
  );

  const result: CreatedCatalogProduct = {
    syncRecordId: prepared.syncRecordId,
    productId: product.id,
    templateCatalogMappingId: templateRef.id,
    templateIntegrationKey: prepared.item.template.integrationKey,
    variants: prepared.item.variants.map((variant) => {
      const ref = requireRow(variantRefByKey.get(variant.integrationKey));
      const medusaVariantId = requireRow(ref.medusaVariantId);

      return {
        integrationKey: variant.integrationKey,
        odooVariantId: variant.id,
        medusaVariantId,
        catalogMappingId: ref.id,
        disposition: "created" as const,
        availability: isCatalogVariantUnavailable(prepared.item, variant)
          ? ("unavailable" as const)
          : ("available" as const),
      };
    }),
    sourceRevision: prepared.item.sourceRevision,
    nextCursor: prepared.nextCursor,
  };

  // The orchestrator owns the Sync Record lifecycle; this step only produces
  // the durable result it will store.
  return new StepResponse(result);
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

function requireRow<Value>(value: Value | undefined | null, message?: string): Value {
  if (!value) {
    throw invalidResult(message ?? "The Catalog projection result is incomplete.");
  }

  return value;
}

function invalidResult(message: string): MedusaError {
  return catalogError("catalog_projection_result_invalid", message);
}

function sourceRejected(message: string): MedusaError {
  return catalogError("catalog_source_rejected", message);
}

const createProjectionStep = createStep(
  "create-catalog-projection",
  createProjection,
  revertProjection,
);

const completeImportStep = createStep("complete-catalog-import", completeImport);

export const createCatalogProductWorkflow = createWorkflow(
  "create-catalog-product",
  composeCatalogProductImport,
);
