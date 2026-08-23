import {
  acquireLockStep,
  releaseLockStep,
  updateProductsWorkflow,
} from "@medusajs/medusa/core-flows";
import { ProductStatus } from "@medusajs/framework/utils";
import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
  transform,
  when,
} from "@medusajs/framework/workflows-sdk";
import {
  CATALOG_SYNC_MODULE,
  type CatalogStorefrontAvailabilitySnapshot,
  type CatalogSyncModule,
} from "~/modules/catalog-sync";
import {
  PRODUCT_AUTHORING_MODULE,
  type ProductAuthoringModuleService,
} from "~/modules/product-authoring";
import type {
  EditAuthoringInput,
  ProductAuthoringRecordView,
} from "~/modules/product-authoring/types";

type EditAuthoringStepResult = Readonly<{
  previous: ProductAuthoringRecordView;
  record: ProductAuthoringRecordView;
}>;

const editAuthoringStep = createStep<
  EditAuthoringInput,
  EditAuthoringStepResult,
  ProductAuthoringRecordView
>(
  "edit-authoring",
  async (input, { container }) => {
    const authoring = container.resolve<ProductAuthoringModuleService>(PRODUCT_AUTHORING_MODULE);
    const previous = await authoring.getAuthoring(input.productId);
    if (!previous) {
      await authoring.requireRecord(input.productId);
      throw new Error("The Authoring record lookup returned no value.");
    }
    const record = await authoring.editAuthoring(input);

    return new StepResponse({ previous, record }, previous);
  },
  async (previous, { container }) => {
    if (!previous) {
      return;
    }

    const authoring = container.resolve<ProductAuthoringModuleService>(PRODUCT_AUTHORING_MODULE);
    await authoring.restoreAuthoring(previous);
  },
);

const demoteCatalogAvailabilityStep = createStep<
  string,
  void,
  readonly CatalogStorefrontAvailabilitySnapshot[]
>(
  "demote-catalog-availability",
  async (productId, { container }) => {
    const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
    const projection = await catalogSync.projectAvailability(productId, false);
    return new StepResponse(undefined, projection.previous);
  },
  async (previous, { container }) => {
    if (!previous) {
      return;
    }
    const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
    await catalogSync.restoreAvailability(previous);
  },
);

export const editAuthoringWorkflow = createWorkflow<
  EditAuthoringInput,
  ProductAuthoringRecordView,
  []
>("edit-authoring", function (input) {
  const lock = transform(input, ({ productId }) => ({
    key: `product-authoring:${productId}`,
    timeout: 5,
    ttl: 30,
  }));
  acquireLockStep(lock);

  const edited = editAuthoringStep(input);
  when("demote-published-authoring-product", edited, ({ previous, record }) => {
    return previous.state === "published" && record.state !== "published";
  }).then(() => {
    demoteCatalogAvailabilityStep(transform(edited, ({ record }) => record.productId));
    const update = transform(edited, ({ record }) => ({
      products: [{ id: record.productId, status: ProductStatus.DRAFT }],
    }));
    return updateProductsWorkflow.runAsStep({ input: update });
  });

  releaseLockStep(transform(lock, ({ key }) => ({ key })));

  return new WorkflowResponse(transform(edited, ({ record }) => record));
});
