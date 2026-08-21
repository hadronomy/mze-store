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
export const ODOO_ATTRIBUTE_MODES = ["always", "dynamic", "never"] as const;

export type CatalogSyncState = (typeof CATALOG_SYNC_STATES)[number];
export type OdooCatalogModel = (typeof ODOO_CATALOG_MODELS)[number];
export type OdooAttributeMode = (typeof ODOO_ATTRIBUTE_MODES)[number];

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
  sourceFingerprint: string;
  sourceRevision: CatalogCursor;
  nextCursor: CatalogCursor | null;
}>;

export type CatalogVariantDisposition =
  | "created"
  | "updated"
  | "unchanged"
  | "archived"
  | "reactivated";

export type CatalogVariantSynchronization = Readonly<{
  integrationKey: string;
  odooVariantId: number;
  medusaVariantId: string;
  catalogMappingId: string;
  disposition: CatalogVariantDisposition;
  availability: "available" | "unavailable";
}>;

export type CatalogSynchronizationResult = Readonly<{
  syncRecordId: string;
  productId: string;
  templateCatalogMappingId: string;
  variants: readonly CatalogVariantSynchronization[];
  sourceRevision: CatalogCursor;
  nextCursor: CatalogCursor | null;
}>;

export type CompleteCatalogImportInput = CatalogImportSource &
  Readonly<{
    syncRecordId: string;
    result: CatalogSynchronizationResult;
  }>;

export type CreateCatalogMappingInput = Readonly<{
  odooModel: OdooCatalogModel;
  odooDatabaseId: number;
  odooIntegrationKey: string;
  sourceLabel: string;
  sourceInternalReference: string | null;
  sourceBarcode: string | null;
  sourceRevision: CatalogCursor;
  sourceFingerprint: string;
  medusaProductId: string;
  medusaVariantId: string | null;
  syncRecordId: string;
  archived: boolean;
}>;

export type CreateCatalogAttributeInput = Readonly<{
  odooAttributeId: number;
  variantCreationMode: OdooAttributeMode;
  sourceLabel: string;
  medusaProductOptionId: string | null;
  values: readonly Readonly<{
    odooAttributeValueId: number;
    odooTemplateAttributeValueId: number;
    sourceLabel: string;
    medusaProductOptionValueId: string | null;
  }>[];
}>;

export type CreateCatalogVariantSelectionInput = Readonly<{
  variantIntegrationKey: string;
  selections: readonly Readonly<{
    odooAttributeId: number;
    odooAttributeValueId: number;
  }>[];
}>;

export type CreateCatalogProjectionInput = Readonly<{
  mappings: readonly CreateCatalogMappingInput[];
  attributes: readonly CreateCatalogAttributeInput[];
  variantSelections: readonly CreateCatalogVariantSelectionInput[];
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
