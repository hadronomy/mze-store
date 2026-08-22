import { MedusaError } from "@medusajs/framework/utils";
import type {
  CatalogBatch,
  Options as OdooBridgeOptions,
  SourceRevision,
} from "@mze-store/odoo-bridge";
import type { CatalogSynchronizationResult } from "./schema";

export const CATALOG_SYNC_MODULE = "catalog_sync" as const;

// Issue #131 fixes this vocabulary and #137 consumes every value, so the
// closed set stays complete even though catalog intake only writes
// in_progress, succeeded, and failed today.
export const CATALOG_SYNC_STATES = [
  "pending",
  "in_progress",
  "succeeded",
  "failed",
  "dead_letter",
  "archived",
] as const;
export type CatalogSyncState = (typeof CATALOG_SYNC_STATES)[number];

export const ODOO_CATALOG_MODELS = ["product.product", "product.template"] as const;
export type OdooCatalogModel = (typeof ODOO_CATALOG_MODELS)[number];

export const ODOO_ATTRIBUTE_MODES = ["always", "dynamic", "never"] as const;
export type OdooAttributeMode = (typeof ODOO_ATTRIBUTE_MODES)[number];

export type MedusaErrorType = (typeof MedusaError.Types)[keyof typeof MedusaError.Types];

// The closed vocabulary of Catalog failures. Every error this module raises
// carries one of these codes, so callers can recover by code instead of by
// message text.
export const CATALOG_SYNC_ERROR_CODES = [
  "catalog_bridge_configuration_invalid",
  "catalog_import_cancelled",
  "catalog_source_unavailable",
  "catalog_source_rejected",
  "catalog_source_empty",
  "catalog_source_missing_variant",
  "catalog_identity_conflict",
  "catalog_structure_conflict",
  "catalog_operation_conflict",
  "catalog_operation_in_progress",
  "catalog_projection_result_invalid",
  "catalog_result_invalid",
  "catalog_failure_record_invalid",
  "catalog_import_failed",
  "catalog_product_refetch_failed",
] as const;

export type CatalogErrorCode = (typeof CATALOG_SYNC_ERROR_CODES)[number];

export type CatalogSource = Readonly<{
  readNextCatalogItem: (
    options?: Readonly<{ cursor?: SourceRevision | null; signal?: AbortSignal }>,
  ) => Promise<CatalogBatch>;
  close: () => Promise<void>;
}>;

export type CatalogSyncModuleOptions = Readonly<{
  odoo: OdooBridgeOptions;
  source?: CatalogSource;
}>;

export type BeginCatalogSyncInput = Readonly<{
  operationId: string;
  requestFingerprint: string;
}>;

export type CatalogSyncStart =
  | Readonly<{ tag: "started"; syncRecordId: string }>
  | Readonly<{ tag: "replayed"; result: CatalogSynchronizationResult }>;

// The record side of a failure stores what happened, so its code stays open:
// product-module or workflow failures may carry foreign codes. The throw
// sites above own the closed union.
export type CatalogSyncFailure = Readonly<{
  type: MedusaErrorType;
  code: string | null;
  message: string;
}>;

export type CatalogSyncOutcome =
  | Readonly<{ tag: "succeeded"; sourceFingerprint: string; result: CatalogSynchronizationResult }>
  | Readonly<{ tag: "failed"; failure: CatalogSyncFailure }>;

export type CatalogSyncSource = Readonly<{
  templateIntegrationKey: string;
  sourceFingerprint: string;
  sourceRevision: SourceRevision;
  nextCursor: SourceRevision | null;
}>;

export type CatalogIdentity = Readonly<{
  odooModel: OdooCatalogModel;
  odooDatabaseId: number;
  odooIntegrationKey: string;
}>;

export type CatalogMappingSeed = Readonly<{
  odooModel: OdooCatalogModel;
  odooDatabaseId: number;
  odooIntegrationKey: string;
  sourceLabel: string;
  sourceInternalReference: string | null;
  sourceBarcode: string | null;
  medusaProductId: string;
  medusaVariantId: string | null;
  archived: boolean;
}>;

export type CatalogAttributeValueSeed = Readonly<{
  odooAttributeValueId: number;
  odooTemplateAttributeValueId: number;
  sourceLabel: string;
  medusaProductOptionValueId: string | null;
}>;

export type CatalogAttributeSeed = Readonly<{
  odooAttributeId: number;
  variantCreationMode: OdooAttributeMode;
  sourceLabel: string;
  medusaProductOptionId: string | null;
  values: readonly CatalogAttributeValueSeed[];
}>;

export type CatalogSelectionInput = Readonly<{
  odooAttributeId: number;
  odooAttributeValueId: number;
}>;

export type CreateCatalogProjectionChange = Readonly<{
  tag: "create";
  syncRecordId: string;
  sourceFingerprint: string;
  sourceRevision: SourceRevision;
  template: CatalogMappingSeed;
  variants: readonly CatalogMappingSeed[];
  attributes: readonly CatalogAttributeSeed[];
  variantSelections: readonly Readonly<{
    variantIndex: number;
    selections: readonly CatalogSelectionInput[];
  }>[];
}>;

export type ExistingCatalogVariantUpdate = Readonly<{
  kind: "existing";
  mappingId: string;
  sourceLabel: string;
  sourceInternalReference: string | null;
  sourceBarcode: string | null;
  archived: boolean;
}>;

export type NewCatalogVariantSeed = Readonly<{ kind: "new" }> & CatalogMappingSeed;

export type UpdateCatalogVariantChange = ExistingCatalogVariantUpdate | NewCatalogVariantSeed;

export type ExistingCatalogValueUpdate = Readonly<{
  kind: "existing";
  mappingId: string;
  sourceLabel: string;
}>;

export type NewCatalogValueSeed = Readonly<{
  kind: "new";
  odooAttributeValueId: number;
  odooTemplateAttributeValueId: number;
  sourceLabel: string;
  medusaProductOptionValueId: string | null;
}>;

export type UpdateCatalogValueChange = ExistingCatalogValueUpdate | NewCatalogValueSeed;

export type UpdateCatalogAttributeChange = Readonly<{
  mappingId: string;
  odooAttributeId: number;
  sourceLabel: string;
  values: readonly UpdateCatalogValueChange[];
}>;

export type UpdateCatalogProjectionChange = Readonly<{
  tag: "update";
  syncRecordId: string;
  sourceFingerprint: string;
  sourceRevision: SourceRevision;
  template: Readonly<{
    mappingId: string;
    sourceLabel: string;
    archived: boolean;
  }>;
  variants: readonly UpdateCatalogVariantChange[];
  attributes: readonly UpdateCatalogAttributeChange[];
  newVariantSelections: readonly Readonly<{
    variantIndex: number;
    selections: readonly CatalogSelectionInput[];
  }>[];
}>;

export type TouchCatalogProjectionChange = Readonly<{
  tag: "touch";
  syncRecordId: string;
  mappingIds: readonly string[];
  attributeIds: readonly string[];
  valueIds: readonly string[];
  selectionIds: readonly string[];
}>;

export type CatalogProjectionChange =
  | CreateCatalogProjectionChange
  | UpdateCatalogProjectionChange
  | TouchCatalogProjectionChange;

export type CatalogProjectionMappingRef = Readonly<{
  id: string;
  odooModel: OdooCatalogModel;
  odooIntegrationKey: string;
  medusaProductId: string;
  medusaVariantId: string | null;
}>;

export type CatalogMappingSnapshot = Readonly<{
  id: string;
  source_revision_changed_at: string;
  source_revision_product_id: number;
  source_fingerprint: string;
  source_label: string;
  source_internal_reference: string | null;
  source_barcode: string | null;
  archived: boolean;
  last_sync_record_id: string;
  last_synced_at: string;
}>;

export type CatalogAttributeSnapshot = Readonly<{
  id: string;
  source_label: string;
  last_sync_record_id: string;
  last_synced_at: string;
}>;

export type CatalogValueSnapshot = Readonly<{
  id: string;
  source_label: string;
  last_sync_record_id: string;
  last_synced_at: string;
}>;

export type CatalogProjectionReceipt = Readonly<{
  createdMappingIds: readonly string[];
  createdValueIds: readonly string[];
  createdSelectionIds: readonly string[];
  previousMappings: readonly CatalogMappingSnapshot[];
  previousAttributes: readonly CatalogAttributeSnapshot[];
  previousValues: readonly CatalogValueSnapshot[];
}>;

export type CatalogProjectionCommit = Readonly<{
  receipt: CatalogProjectionReceipt;
  mappings: readonly CatalogProjectionMappingRef[];
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
