import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, ProductStatus } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import { operationIdFromRequest } from "~/api/admin/idempotency";
import { synchronizeCatalogItemWorkflow } from "~/catalog/synchronize-catalog-item";
import {
  CATALOG_SYNC_MODULE,
  catalogError,
  type CatalogSyncModule,
  type CatalogVariantAvailability,
} from "~/modules/catalog-sync";
import type { CatalogImportRequest } from "~/modules/catalog-sync/schema";

const PRODUCT_FIELDS = [
  "id",
  "title",
  "description",
  "status",
  "options.id",
  "options.title",
  "options.is_exclusive",
  "options.metadata",
  "options.values.id",
  "options.values.value",
  "variants.id",
  "variants.title",
  "variants.sku",
  "variants.barcode",
  "variants.prices.id",
  "variants.prices.amount",
  "variants.prices.currency_code",
] as const;

const ImportedProductSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  status: z.enum([
    ProductStatus.DRAFT,
    ProductStatus.PROPOSED,
    ProductStatus.PUBLISHED,
    ProductStatus.REJECTED,
  ]),
  options: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      is_exclusive: z.boolean(),
      metadata: z.record(z.string(), z.unknown()).nullable(),
      values: z.array(z.object({ id: z.string(), value: z.string() })),
    }),
  ),
  variants: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      sku: z.string().nullable(),
      barcode: z.string().nullable(),
      prices: z.array(
        z.object({
          id: z.string(),
          amount: z.number(),
          currency_code: z.string(),
        }),
      ),
    }),
  ),
});

export async function POST(
  req: AuthenticatedMedusaRequest<CatalogImportRequest>,
  res: MedusaResponse,
): Promise<void> {
  const operationId = operationIdFromRequest(req, "catalog-import");
  const { result: imported } = await synchronizeCatalogItemWorkflow(req.scope).run({
    input: {
      operationId,
      cursor: req.validatedBody.cursor ?? null,
    },
    context: { transactionId: operationId },
  });
  const catalogSync = req.scope.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  const availabilityByVariantId = new Map(
    (await catalogSync.getVariantAvailability(imported.productId)).map((availability) => [
      availability.medusaVariantId,
      availability,
    ]),
  );
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: products } = await query.graph({
    entity: "product",
    fields: [...PRODUCT_FIELDS],
    filters: { id: imported.productId },
  });
  const decoded = ImportedProductSchema.array().safeParse(products);
  const product = decoded.success ? decoded.data[0] : undefined;

  if (!product) {
    throw catalogError(
      "catalog_product_refetch_failed",
      `Imported Product ${imported.productId} could not be refetched.`,
    );
  }

  res.status(200).json({
    product,
    catalog_import: {
      disposition: imported.disposition,
      operation_id: operationId,
      sync_record_id: imported.syncRecordId,
      catalog_mapping_ids: {
        template: imported.templateCatalogMappingId,
        variants: imported.variants.map(({ catalogMappingId }) => catalogMappingId),
      },
      variants: imported.variants.map((variant) => ({
        ...toVariantAvailabilityResponse(
          requireVariantAvailability(availabilityByVariantId, variant.medusaVariantId),
        ),
        integration_key: variant.integrationKey,
        odoo_variant_id: variant.odooVariantId,
        medusa_variant_id: variant.medusaVariantId,
        catalog_mapping_id: variant.catalogMappingId,
        disposition: variant.disposition,
      })),
      source_revision: toSourceRevisionResponse(imported.sourceRevision),
      next_cursor:
        imported.nextCursor === null ? null : toSourceRevisionResponse(imported.nextCursor),
    },
  });
}

function requireVariantAvailability(
  availabilityByVariantId: ReadonlyMap<string, CatalogVariantAvailability>,
  variantId: string,
): CatalogVariantAvailability {
  const availability = availabilityByVariantId.get(variantId);
  if (!availability) {
    throw catalogError(
      "catalog_projection_result_invalid",
      `The Catalog result has no availability projection for Variant ${variantId}.`,
    );
  }

  return availability;
}

function toVariantAvailabilityResponse(availability: CatalogVariantAvailability) {
  return {
    source_available: availability.sourceAvailable,
    approval_state: availability.approvalState,
    storefront_available: availability.storefrontAvailable,
  };
}

function toSourceRevisionResponse(revision: { changedAt: string; productId: number }) {
  return { write_date: revision.changedAt, id: revision.productId };
}
