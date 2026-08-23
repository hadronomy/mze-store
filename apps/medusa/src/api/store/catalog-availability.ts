import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { CATALOG_SYNC_MODULE, catalogError, type CatalogSyncModule } from "~/modules/catalog-sync";

const StoreProductSchema = z
  .object({
    variants: z.array(z.object({ id: z.string() }).passthrough()).optional(),
  })
  .passthrough();
const StoreProductResponseSchema = z.object({ product: StoreProductSchema }).passthrough();
const StoreProductListResponseSchema = z
  .object({ products: z.array(StoreProductSchema) })
  .passthrough();
const StoreVariantSchema = z.object({ id: z.string() }).passthrough();
const StoreVariantListResponseSchema = z
  .object({ variants: z.array(StoreVariantSchema) })
  .passthrough();

export async function requireAvailableCatalogVariant(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction,
): Promise<void> {
  const catalogSync = req.scope.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  const variantId = req.params.id;
  if (!variantId) {
    throw catalogError("catalog_variant_unavailable", "The Variant identifier is required.");
  }
  await catalogSync.assertVariantsAvailable([variantId]);
  next();
}

export async function filterUnavailableCatalogVariants(
  req: MedusaRequest,
  res: MedusaResponse,
  next: MedusaNextFunction,
): Promise<void> {
  const catalogSync = req.scope.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  const unavailable = new Set(await catalogSync.listUnavailableVariantIds());
  const sendJson = res.json.bind(res);

  res.json = (body) => sendJson(filterStoreProductResponse(body, unavailable));
  next();
}

function filterStoreProductResponse(
  body: Parameters<MedusaResponse["json"]>[0],
  unavailable: ReadonlySet<string>,
): Parameters<MedusaResponse["json"]>[0] {
  const single = StoreProductResponseSchema.safeParse(body);
  if (single.success) {
    return {
      ...single.data,
      product: filterProduct(single.data.product, unavailable),
    };
  }

  const list = StoreProductListResponseSchema.safeParse(body);
  if (list.success) {
    return {
      ...list.data,
      products: list.data.products.map((product) => filterProduct(product, unavailable)),
    };
  }

  const variants = StoreVariantListResponseSchema.safeParse(body);
  if (variants.success) {
    return {
      ...variants.data,
      variants: variants.data.variants.filter(({ id }) => !unavailable.has(id)),
    };
  }

  return body;
}

function filterProduct(
  product: z.infer<typeof StoreProductSchema>,
  unavailable: ReadonlySet<string>,
): z.infer<typeof StoreProductSchema> {
  if (!product.variants) {
    return product;
  }

  return {
    ...product,
    variants: product.variants.filter(({ id }) => !unavailable.has(id)),
  };
}
