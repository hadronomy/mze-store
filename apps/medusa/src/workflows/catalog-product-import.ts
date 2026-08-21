import type { CreateProductWorkflowInputDTO, LinkDefinition } from "@medusajs/framework/types";
import { MedusaError, Modules, ProductStatus } from "@medusajs/framework/utils";
import type { StepExecutionContext } from "@medusajs/framework/workflows-sdk";
import {
  StepResponse,
  WorkflowResponse,
  createStep,
  createWorkflow,
  transform,
  type WorkflowData,
} from "@medusajs/framework/workflows-sdk";
import type { CatalogItem } from "@mze-store/odoo-bridge";
import {
  createProductsWorkflow,
  createRemoteLinkStep,
  updateProductOptionsWorkflow,
} from "@medusajs/medusa/core-flows";
import { CATALOG_SYNC_MODULE } from "~/modules/catalog-sync";
import type { CatalogMappingRecord, CatalogSyncModule } from "~/modules/catalog-sync/service";
import type { CatalogCursor, CreateCatalogMappingInput } from "~/modules/catalog-sync/types";

export type PreparedCatalogImport = Readonly<{
  syncRecordId: string;
  item: CatalogItem;
  currencyCode: string;
  sourceFingerprint: string;
  nextCursor: CatalogCursor | null;
}>;

export type CreatedCatalogProduct = Readonly<{
  syncRecordId: string;
  productId: string;
  variantId: string;
  catalogMappingIds: Readonly<{
    template: string;
    variant: string;
  }>;
  sourceRevision: CatalogCursor;
  nextCursor: CatalogCursor | null;
}>;

type CreatedProduct = Readonly<{
  id: string;
  options?: ReadonlyArray<{ readonly id: string }>;
  variants?: ReadonlyArray<{ readonly id: string }>;
}>;

type UpdatedOption = Readonly<{ id: string }>;

type CreatedMappings = Readonly<{
  template: CatalogMappingRecord;
  variant: CatalogMappingRecord;
}>;

type CreateMappingsStepInput = Readonly<{
  prepared: PreparedCatalogImport;
  products: ReadonlyArray<CreatedProduct>;
  options: ReadonlyArray<UpdatedOption>;
}>;

type CompleteImportStepInput = CreateMappingsStepInput &
  Readonly<{
    mappings: CreatedMappings;
    links: LinkDefinition[];
  }>;

function toCreateProductInput(prepared: PreparedCatalogImport): CreateProductWorkflowInputDTO[] {
  const variant = requireOnlySourceVariant(prepared.item);

  return [
    {
      title: prepared.item.template.name,
      description: prepared.item.template.description ?? undefined,
      status: ProductStatus.DRAFT,
      options: [
        {
          title: "Configuration",
          values: ["Default"],
          is_exclusive: true,
          metadata: { mze_hidden: true, mze_source_generated: true },
        },
      ],
      variants: [
        {
          title: variant.name,
          sku: variant.internalReference,
          barcode: variant.barcode,
          allow_backorder: false,
          manage_inventory: true,
          options: { Configuration: "Default" },
          prices: [
            {
              amount: Number(variant.price),
              currency_code: prepared.currencyCode,
            },
          ],
        },
      ],
    },
  ];
}

async function createCatalogMappings(
  { prepared, products, options }: CreateMappingsStepInput,
  { container }: StepExecutionContext,
): Promise<StepResponse<CreatedMappings, string[]>> {
  const product = requireOnlyProduct(products);
  requireOnlyUpdatedOption(options);
  const variant = requireOnlyProductVariant(product);
  const sourceVariant = requireOnlySourceVariant(prepared.item);
  const common = {
    sourceRevision: prepared.item.sourceRevision,
    sourceFingerprint: prepared.sourceFingerprint,
    medusaProductId: product.id,
    syncRecordId: prepared.syncRecordId,
  } as const;
  const inputs: readonly CreateCatalogMappingInput[] = [
    {
      ...common,
      odooModel: prepared.item.template.model,
      odooDatabaseId: prepared.item.template.id,
      odooIntegrationKey: prepared.item.template.integrationKey,
      medusaVariantId: null,
    },
    {
      ...common,
      odooModel: sourceVariant.model,
      odooDatabaseId: sourceVariant.id,
      odooIntegrationKey: sourceVariant.integrationKey,
      medusaVariantId: variant.id,
    },
  ];
  const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  const mappings = await catalogSync.createMappings(inputs);
  const template = mappings.find((mapping) => mapping.odoo_model === "product.template");
  const variantMapping = mappings.find((mapping) => mapping.odoo_model === "product.product");

  if (!template || !variantMapping || mappings.length !== 2) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The Catalog Sync module did not create the template and Variant mappings.",
      "catalog_mapping_result_invalid",
    );
  }

  return new StepResponse(
    { template, variant: variantMapping },
    mappings.map(({ id }) => id),
  );
}

async function compensateCatalogMappings(
  mappingIds: string[] | undefined,
  { container }: StepExecutionContext,
): Promise<void> {
  if (!mappingIds?.length) {
    return;
  }

  const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  await catalogSync.deleteCatalogMappings(mappingIds);
}

function toLinkDefinitions(input: {
  mappings: CreatedMappings;
  products: ReadonlyArray<CreatedProduct>;
}): LinkDefinition[] {
  const product = requireOnlyProduct(input.products);
  const variant = requireOnlyProductVariant(product);

  return [
    {
      [Modules.PRODUCT]: { product_id: product.id },
      [CATALOG_SYNC_MODULE]: { catalog_mapping_id: input.mappings.template.id },
    },
    {
      [Modules.PRODUCT]: { product_variant_id: variant.id },
      [CATALOG_SYNC_MODULE]: { catalog_mapping_id: input.mappings.variant.id },
    },
  ];
}

async function completeCatalogImport(
  { prepared, products, mappings }: CompleteImportStepInput,
  { container }: StepExecutionContext,
): Promise<StepResponse<CreatedCatalogProduct>> {
  const product = requireOnlyProduct(products);
  const variant = requireOnlyProductVariant(product);
  const sourceVariant = requireOnlySourceVariant(prepared.item);
  const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);

  await catalogSync.completeImport({
    syncRecordId: prepared.syncRecordId,
    templateIntegrationKey: prepared.item.template.integrationKey,
    variantIntegrationKey: sourceVariant.integrationKey,
    sourceFingerprint: prepared.sourceFingerprint,
    sourceRevision: prepared.item.sourceRevision,
    nextCursor: prepared.nextCursor,
    productId: product.id,
    variantId: variant.id,
    templateCatalogMappingId: mappings.template.id,
    variantCatalogMappingId: mappings.variant.id,
  });

  return new StepResponse({
    syncRecordId: prepared.syncRecordId,
    productId: product.id,
    variantId: variant.id,
    catalogMappingIds: { template: mappings.template.id, variant: mappings.variant.id },
    sourceRevision: prepared.item.sourceRevision,
    nextCursor: prepared.nextCursor,
  });
}

function composeCatalogProductImport(input: WorkflowData<PreparedCatalogImport>) {
  const productsInput = transform(input, toCreateProductInput);
  const products = createProductsWorkflow.runAsStep({ input: { products: productsInput } });
  const optionUpdate = transform({ products }, toHiddenOptionUpdate);
  const options = updateProductOptionsWorkflow.runAsStep({ input: optionUpdate });
  const mappings = createCatalogMappingsStep({ prepared: input, products, options });
  const links = transform({ mappings, products }, toLinkDefinitions);
  const createdLinks = createRemoteLinkStep(links).config({
    name: "create-catalog-product-mapping-links",
  });
  const completed = completeCatalogImportStep({
    prepared: input,
    products,
    options,
    mappings,
    links: createdLinks,
  });

  return new WorkflowResponse(completed);
}

function toHiddenOptionUpdate(input: { products: ReadonlyArray<CreatedProduct> }) {
  const product = requireOnlyProduct(input.products);
  const option = requireOnlyProductOption(product);

  return {
    selector: { id: option.id },
    update: { metadata: { mze_hidden: true, mze_source_generated: true } },
  };
}

function requireOnlyProduct(products: ReadonlyArray<CreatedProduct>): CreatedProduct {
  const [product] = products;
  if (!product || products.length !== 1) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The Product workflow must return one Product.",
      "catalog_product_result_invalid",
    );
  }

  return product;
}

function requireOnlyProductVariant(product: CreatedProduct): { readonly id: string } {
  const [variant] = product.variants ?? [];
  if (!variant || product.variants?.length !== 1) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The Product workflow must return one Variant.",
      "catalog_variant_result_invalid",
    );
  }

  return variant;
}

function requireOnlyProductOption(product: CreatedProduct): { readonly id: string } {
  const [option] = product.options ?? [];
  if (!option || product.options?.length !== 1) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The Product workflow must return the generated Configuration option.",
      "catalog_option_result_invalid",
    );
  }

  return option;
}

function requireOnlyUpdatedOption(options: ReadonlyArray<UpdatedOption>): UpdatedOption {
  const [option] = options;
  if (!option || options.length !== 1) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The Product option workflow must update one Configuration option.",
      "catalog_option_update_result_invalid",
    );
  }

  return option;
}

function requireOnlySourceVariant(item: CatalogItem): CatalogItem["variants"][number] {
  const [variant] = item.variants;
  if (!variant || item.variants.length !== 1) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "The first Catalog intake slice requires exactly one Odoo Variant.",
      "catalog_source_rejected",
    );
  }

  return variant;
}

const createCatalogMappingsStep = createStep(
  "create-catalog-mappings",
  createCatalogMappings,
  compensateCatalogMappings,
);

const completeCatalogImportStep = createStep("complete-catalog-import", completeCatalogImport);

export const createCatalogProductWorkflow = createWorkflow(
  "create-catalog-product",
  composeCatalogProductImport,
);
