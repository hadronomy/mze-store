import type { MedusaContainer } from "@medusajs/framework/types";
import { StepResponse } from "@medusajs/framework/workflows-sdk";
import {
  addToCartWorkflow,
  completeCartWorkflow,
  createCartWorkflow,
} from "@medusajs/medusa/core-flows";
import { CATALOG_SYNC_MODULE, type CatalogSyncModule } from "~/modules/catalog-sync";

function getVariantIds(
  items: readonly { variant_id?: string | null }[] | null | undefined,
): string[] {
  return (items ?? []).flatMap(({ variant_id }) => (variant_id ? [variant_id] : []));
}

async function assertAvailable(
  container: MedusaContainer,
  items: readonly { variant_id?: string | null }[] | null | undefined,
): Promise<void> {
  const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  await catalogSync.assertVariantsAvailable(getVariantIds(items));
}

createCartWorkflow.hooks.validate(async ({ input }, { container }) => {
  await assertAvailable(container, input.items);
  return new StepResponse(void 0);
});

addToCartWorkflow.hooks.validate(async ({ input }, { container }) => {
  await assertAvailable(container, input.items);
  return new StepResponse(void 0);
});

completeCartWorkflow.hooks.validate(async ({ cart }, { container }) => {
  await assertAvailable(container, cart.items);
  return new StepResponse(void 0);
});
