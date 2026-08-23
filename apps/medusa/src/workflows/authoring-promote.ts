import type { ProductTypes } from "@medusajs/framework/types";
import type { StepExecutionContext } from "@medusajs/framework/workflows-sdk";
import {
  StepResponse,
  createStep,
  createWorkflow,
  WorkflowResponse,
  transform,
} from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys, ProductStatus } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import {
  acquireLockStep,
  releaseLockStep,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows";
import {
  CATALOG_SYNC_MODULE,
  type CatalogSyncModule,
  type CatalogProjectionStatus,
  type CatalogStorefrontAvailabilitySnapshot,
  type CatalogVariantApprovalSnapshot,
} from "~/modules/catalog-sync";
import {
  PRODUCT_AUTHORING_MODULE,
  type ProductAuthoringRecordView,
  authoringError,
  type ProductAuthoringModuleService,
} from "~/modules/product-authoring";

export interface PromoteAuthoringInput {
  readonly productId: string;
}

interface PromotionChecks {
  readonly productId: string;
  readonly previousStatus: ProductStatus;
  readonly authoringWasPublished: boolean;
}

interface PromotionAvailability extends PromotionChecks {
  readonly productAvailable: boolean;
}

export type PromotedAuthoringProduct = Readonly<{
  id: string;
  status: typeof ProductStatus.PUBLISHED;
}>;

// Decodes the Query projection once at this boundary so every promotion
// check below runs against typed values.
const ProductProjectionSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  status: z.enum([
    ProductStatus.DRAFT,
    ProductStatus.PROPOSED,
    ProductStatus.PUBLISHED,
    ProductStatus.REJECTED,
  ]),
  images: z.array(z.object({ id: z.string() })),
  variants: z.array(
    z.object({
      id: z.string(),
      prices: z.array(z.object({ amount: z.number().nullable() })),
    }),
  ),
});

const validatePromotion = createStep(
  "validate-authoring-promotion",
  async (
    { productId }: PromoteAuthoringInput,
    { container }: StepExecutionContext,
  ): Promise<StepResponse<PromotionChecks>> => {
    const authoring = container.resolve<ProductAuthoringModuleService>(PRODUCT_AUTHORING_MODULE);
    const record = await authoring.requireRecord(productId);
    if (record.state !== "ready" && record.state !== "published") {
      throw authoringError(
        "authoring_state_conflict",
        `The Product ${productId} must be ready before promotion; it is ${record.state}.`,
      );
    }

    const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
    const projection: CatalogProjectionStatus =
      await catalogSync.getCatalogProjectionStatus(productId);
    if (!projection.mapped) {
      throw authoringError(
        "authoring_product_unmapped",
        `The Product ${productId} has no Catalog Mapping to an Odoo template.`,
      );
    }
    if (!projection.syncResolved) {
      throw authoringError(
        "authoring_sync_unresolved",
        `The Product ${productId} has a Catalog Mapping whose last sync did not succeed.`,
      );
    }
    if (projection.sourceAvailable === false) {
      throw authoringError(
        "authoring_source_unavailable",
        `The Odoo Product source for ${productId} is unavailable.`,
      );
    }
    const variants = await catalogSync.getVariantAvailability(productId);
    if (!variants.some(({ sourceAvailable }) => sourceAvailable)) {
      throw authoringError(
        "authoring_source_unavailable",
        `The Odoo Product source for ${productId} has no saleable Variant.`,
      );
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY);
    const { data } = await query.graph({
      entity: "product",
      fields: [
        "id",
        "title",
        "description",
        "status",
        "images.id",
        "variants.id",
        "variants.prices.amount",
      ],
      filters: { id: productId },
    });
    const decoded = ProductProjectionSchema.array().safeParse(data);
    const product = decoded.success ? decoded.data[0] : undefined;
    if (!product) {
      throw authoringError(
        "authoring_product_unmapped",
        `The Product ${productId} could not be loaded.`,
      );
    }
    if (!product.title?.trim() || !product.description?.trim()) {
      throw authoringError(
        "authoring_editorial_incomplete",
        `The Product ${productId} needs a title and a description before promotion.`,
      );
    }
    if (product.images.length === 0) {
      throw authoringError(
        "authoring_media_missing",
        `The Product ${productId} needs at least one Product Ground asset before promotion.`,
      );
    }
    if (!product.variants.length) {
      throw authoringError(
        "authoring_price_invalid",
        `The Product ${productId} has no Variants to price.`,
      );
    }
    for (const variant of product.variants) {
      const priced = variant.prices.some(
        (price) => price.amount !== null && Number.isFinite(price.amount) && price.amount >= 0,
      );
      if (!priced) {
        throw authoringError(
          "authoring_price_invalid",
          `The Variant ${variant.id} has no valid Odoo price before promotion.`,
        );
      }
    }

    return new StepResponse({
      productId,
      previousStatus: product.status,
      authoringWasPublished: record.state === "published",
    });
  },
);

const approveCatalogVariants = createStep<
  PromotionChecks,
  PromotionChecks,
  readonly CatalogVariantApprovalSnapshot[]
>(
  "approve-catalog-variants",
  async (checks, { container }) => {
    const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
    const previous = await catalogSync.approveVariants(checks.productId);
    return new StepResponse(checks, previous);
  },
  async (previous, { container }) => {
    if (!previous) {
      return;
    }
    const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
    await catalogSync.restoreVariantApprovals(previous);
  },
);

const projectCatalogAvailability = createStep<
  PromotionChecks,
  PromotionAvailability,
  readonly CatalogStorefrontAvailabilitySnapshot[]
>(
  "project-catalog-availability",
  async (checks, { container }) => {
    const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
    const projection = await catalogSync.projectAvailability(checks.productId, true);
    return new StepResponse(
      { ...checks, productAvailable: projection.productAvailable },
      projection.previous,
    );
  },
  async (previous, { container }) => {
    if (!previous) {
      return;
    }
    const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
    await catalogSync.restoreAvailability(previous);
  },
);

const markPublished = createStep(
  "mark-authoring-published",
  async (
    checks: PromotionChecks,
    { container }: StepExecutionContext,
  ): Promise<StepResponse<PromotionChecks, ProductAuthoringRecordView>> => {
    const authoring = container.resolve<ProductAuthoringModuleService>(PRODUCT_AUTHORING_MODULE);
    const previous = await authoring.getAuthoring(checks.productId);
    if (!previous) {
      await authoring.requireRecord(checks.productId);
      throw new Error("The Authoring record lookup returned no value.");
    }
    await authoring.markPublished(checks.productId);

    return new StepResponse(checks, previous);
  },
  async (previous, { container }) => {
    if (!previous) {
      return;
    }

    const authoring = container.resolve<ProductAuthoringModuleService>(PRODUCT_AUTHORING_MODULE);
    await authoring.restoreAuthoring(previous);
  },
);

export const promoteAuthoringWorkflow = createWorkflow<
  PromoteAuthoringInput,
  PromotedAuthoringProduct,
  []
>("promote-authoring-product", function (input: PromoteAuthoringInput) {
  const lock = transform(input, ({ productId }) => ({
    key: `product-authoring:${productId}`,
    timeout: 5,
    ttl: 30,
  }));
  acquireLockStep(lock);

  const checks = validatePromotion(input);
  const approved = approveCatalogVariants(checks);
  const published = markPublished(approved);
  const availability = projectCatalogAvailability(published);
  const update = transform(availability, ({ productId, productAvailable }) => {
    if (!productAvailable) {
      throw authoringError(
        "authoring_source_unavailable",
        `The Odoo Product source for ${productId} has no saleable Variant.`,
      );
    }

    return { products: [{ id: productId, status: ProductStatus.PUBLISHED }] };
  });
  const products = updateProductsWorkflow.runAsStep({ input: update });
  releaseLockStep(transform(lock, ({ key }) => ({ key })));

  return new WorkflowResponse(
    transform(products, (updated: ProductTypes.ProductDTO[]): PromotedAuthoringProduct => {
      const product = updated[0];
      if (!product) {
        throw authoringError(
          "authoring_product_unmapped",
          "The Product workflow returned no Product.",
        );
      }

      return { id: product.id, status: ProductStatus.PUBLISHED };
    }),
  );
});
