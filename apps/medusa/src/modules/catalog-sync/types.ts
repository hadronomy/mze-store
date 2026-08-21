import type {
  CatalogBatch,
  OdooBridgeClient,
  OdooBridgeGateway,
  Options as OdooBridgeOptions,
  ReadCatalogBatchResult,
} from "@mze-store/odoo-bridge";

export const CATALOG_SYNC_MODULE = "catalog_sync" as const;

export const CATALOG_SYNC_STATES = [
  "pending",
  "in_progress",
  "succeeded",
  "failed",
  "dead_letter",
  "archived",
] as const;

export const ODOO_CATALOG_MODELS = ["product.product", "product.template"] as const;

export type CatalogSyncState = (typeof CATALOG_SYNC_STATES)[number];
export type OdooCatalogModel = (typeof ODOO_CATALOG_MODELS)[number];

export type CatalogCursor = Readonly<{
  changedAt: string;
  productId: number;
}>;

export type CatalogSyncModuleOptions = Readonly<{
  odoo: OdooBridgeOptions;
  gateway?: OdooBridgeGateway;
}>;

export type BeginCatalogImportInput = Readonly<{
  operationId: string;
  requestFingerprint: string;
}>;

export type CatalogImportFailure = Readonly<{
  type: string;
  code: string | null;
  message: string;
}>;

export type CatalogImportSource = Readonly<{
  templateIntegrationKey: string;
  variantIntegrationKey: string;
  sourceFingerprint: string;
  sourceRevision: CatalogCursor;
  nextCursor: CatalogCursor | null;
}>;

export type CompleteCatalogImportInput = CatalogImportSource &
  Readonly<{
    syncRecordId: string;
    productId: string;
    variantId: string;
    templateCatalogMappingId: string;
    variantCatalogMappingId: string;
  }>;

export type CreateCatalogMappingInput = Readonly<{
  odooModel: OdooCatalogModel;
  odooDatabaseId: number;
  odooIntegrationKey: string;
  sourceRevision: CatalogCursor;
  sourceFingerprint: string;
  medusaProductId: string;
  medusaVariantId: string | null;
  syncRecordId: string;
}>;

export type ReadCatalogBatch = (
  options: Readonly<{
    cursor?: CatalogCursor | null;
    limit: 1;
    signal?: AbortSignal;
  }>,
) => Promise<ReadCatalogBatchResult>;

export type OwnedOdooBridgeClient = OdooBridgeClient | undefined;

export type CatalogImportBatch = CatalogBatch;
