import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { operationIdFromRequest } from "~/api/admin/idempotency";
import { importCatalogItem } from "~/catalog/import-catalog-item";
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

export async function POST(
  req: AuthenticatedMedusaRequest<CatalogImportRequest>,
  res: MedusaResponse,
): Promise<void> {
  const operationId = operationIdFromRequest(req, "catalog-import");
  const disconnect = new AbortController();
  const abort = () => disconnect.abort();
  req.once("aborted", abort);
  res.once("close", abort);
  const imported = await importCatalogItem(req.scope, {
    operationId,
    cursor: req.validatedBody.cursor ?? null,
    signal: disconnect.signal,
  }).finally(() => {
    req.off("aborted", abort);
    res.off("close", abort);
  });
  const query = req.scope.resolve(ContainerRegistrationKeys.QUERY);
  const { data: products } = await query.graph({
    entity: "product",
    fields: [...PRODUCT_FIELDS],
    filters: { id: imported.productId },
  });
  const [product] = products;

  if (!product) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `Imported Product ${imported.productId} could not be refetched.`,
      "catalog_product_refetch_failed",
    );
  }

  res.status(200).json({
    product,
    catalog_import: {
      disposition: imported.disposition,
      operation_id: operationId,
      sync_record_id: imported.syncRecordId,
      catalog_mapping_ids: imported.catalogMappingIds,
      source_revision: toSourceRevisionResponse(imported.sourceRevision),
      next_cursor:
        imported.nextCursor === null ? null : toSourceRevisionResponse(imported.nextCursor),
    },
  });
}

function toSourceRevisionResponse(revision: { changedAt: string; productId: number }) {
  return { write_date: revision.changedAt, id: revision.productId };
}
