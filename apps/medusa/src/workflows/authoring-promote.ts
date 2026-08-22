import type { StepExecutionContext } from "@medusajs/framework/workflows-sdk";
import {
  StepResponse,
  createStep,
  createWorkflow,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import type { IProductModuleService } from "@medusajs/framework/types";
import {
  CATALOG_SYNC_MODULE,
  type CatalogSyncModule,
  type CatalogProjectionStatus,
} from "~/modules/catalog-sync";
import {
  PRODUCT_AUTHORING_MODULE,
  authoringError,
  type ProductAuthoringModuleService,
} from "~/modules/product-authoring";

export interface PromoteAuthoringInput {
  readonly productId: string;
}

interface PromotionChecks {
  readonly productId: string;
  readonly previousStatus: string;
}

// Decodes the Query projection once at this boundary so every promotion
// check below runs against typed values.
const ProductProjectionSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  status: z.string(),
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
    if (record.state !== "ready") {
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
    if (!projection.allSyncsSucceeded) {
      throw authoringError(
        "authoring_sync_unresolved",
        `The Product ${productId} has a Catalog Mapping whose last sync did not succeed.`,
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

    return new StepResponse({ productId, previousStatus: product.status });
  },
);

const markPublished = createStep(
  "mark-authoring-published",
  async (
    checks: PromotionChecks,
    { container }: StepExecutionContext,
  ): Promise<StepResponse<void, string>> => {
    const authoring = container.resolve<ProductAuthoringModuleService>(PRODUCT_AUTHORING_MODULE);
    await authoring.markPublished(checks.productId);

    return new StepResponse(undefined, checks.productId);
  },
  async (productId, { container }) => {
    if (!productId) {
      return;
    }

    const authoring = container.resolve<ProductAuthoringModuleService>(PRODUCT_AUTHORING_MODULE);
    await authoring.editAuthoring({ productId, state: "ready" });
  },
);

const projectPublishedStatus = createStep(
  "project-published-status",
  async (
    checks: PromotionChecks,
    { container }: StepExecutionContext,
  ): Promise<StepResponse<{ id: string; status: string }, PromotionChecks>> => {
    const productModule = container.resolve<IProductModuleService>(Modules.PRODUCT);
    const product = await productModule.updateProducts(checks.productId, {
      status: ProductStatus.PUBLISHED,
    });

    return new StepResponse({ id: product.id, status: String(product.status) }, checks);
  },
  async (checks, { container }) => {
    if (!checks) {
      return;
    }

    const productModule = container.resolve<IProductModuleService>(Modules.PRODUCT);
    const status =
      checks.previousStatus === "published"
        ? ProductStatus.PUBLISHED
        : checks.previousStatus === "rejected"
          ? ProductStatus.REJECTED
          : checks.previousStatus === "proposed"
            ? ProductStatus.PROPOSED
            : ProductStatus.DRAFT;
    await productModule.updateProducts(checks.productId, { status });
  },
);

export const promoteAuthoringWorkflow = createWorkflow(
  "promote-authoring-product",
  function (input: PromoteAuthoringInput) {
    const checks = validatePromotion(input);
    markPublished(checks);

    return new WorkflowResponse(projectPublishedStatus(checks));
  },
);
