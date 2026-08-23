import { MedusaError } from "@medusajs/framework/utils";
import type {
  OdooAttributeId,
  OdooAttributeValueId,
  OdooBridgeGateway,
  OdooIntegrationKey,
  OdooProductId,
  OdooTemplateAttributeValueId,
  OdooVariantId,
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

export const CATALOG_VARIANT_APPROVAL_STATES = ["pending", "approved"] as const;
export type CatalogVariantApprovalState = (typeof CATALOG_VARIANT_APPROVAL_STATES)[number];

export type MedusaErrorType = (typeof MedusaError.Types)[keyof typeof MedusaError.Types];

// The closed vocabulary of Catalog failures. Every error this module raises
// carries one of these codes, so callers can recover by code instead of by
// message text.
export const CATALOG_SYNC_ERROR_CODES = [
  "catalog_bridge_configuration_invalid",
  "catalog_import_cancelled",
  "catalog_source_unavailable",
  "catalog_source_rejected",
  "catalog_source_authentication_failed",
  "catalog_source_permission_denied",
  "catalog_source_request_rejected",
  "catalog_source_timed_out",
  "catalog_source_transport_failed",
  "catalog_source_unexpected_status",
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
  "catalog_variant_unavailable",
  "catalog_lock_release_failed",
] as const;

export type CatalogErrorCode = (typeof CATALOG_SYNC_ERROR_CODES)[number];

export const CATALOG_SOURCE_RETRYABILITY = {
  catalog_source_authentication_failed: false,
  catalog_source_permission_denied: false,
  catalog_source_request_rejected: false,
  catalog_source_timed_out: true,
  catalog_source_transport_failed: true,
  catalog_source_unexpected_status: false,
} as const;

export type CatalogSourceFailureCode = keyof typeof CATALOG_SOURCE_RETRYABILITY;

export type CatalogSyncModuleOptions =
  | Readonly<{ gateway: OdooBridgeGateway; odoo?: never }>
  | Readonly<{ gateway?: never; odoo: OdooBridgeOptions }>;

export type BeginCatalogSyncInput = Readonly<{
  operationId: string;
  requestFingerprint: string;
}>;

export type CatalogSyncStart =
  | Readonly<{ tag: "started"; syncRecordId: string }>
  | Readonly<{ tag: "replayed"; result: CatalogSynchronizationResult }>
  | Readonly<{
      tag: "failed";
      syncRecordId: string;
      failure: CatalogSyncFailure;
    }>;

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

export type CatalogIdentity =
  | Readonly<{
      odooModel: "product.template";
      odooDatabaseId: OdooProductId;
      odooIntegrationKey: OdooIntegrationKey;
    }>
  | Readonly<{
      odooModel: "product.product";
      odooDatabaseId: OdooVariantId;
      odooIntegrationKey: OdooIntegrationKey;
    }>;

type CatalogMappingSeedFields = Readonly<{
  sourceLabel: string;
  sourceInternalReference: string | null;
  sourceBarcode: string | null;
  medusaProductId: string;
  sourceAvailable: boolean;
}>;

export type CatalogMappingSeed =
  | (CatalogMappingSeedFields &
      Readonly<{
        odooModel: "product.template";
        odooDatabaseId: OdooProductId;
        odooIntegrationKey: OdooIntegrationKey;
        medusaVariantId: null;
      }>)
  | (CatalogMappingSeedFields &
      Readonly<{
        odooModel: "product.product";
        odooDatabaseId: OdooVariantId;
        odooIntegrationKey: OdooIntegrationKey;
        medusaVariantId: string;
      }>);

export type CatalogAttributeValueSeed = Readonly<{
  odooAttributeValueId: OdooAttributeValueId;
  odooTemplateAttributeValueId: OdooTemplateAttributeValueId;
  sourceLabel: string;
  medusaProductOptionValueId: string | null;
}>;

export type CatalogAttributeSeed = Readonly<{
  odooAttributeId: OdooAttributeId;
  variantCreationMode: OdooAttributeMode;
  sourceLabel: string;
  medusaProductOptionId: string | null;
  values: readonly CatalogAttributeValueSeed[];
}>;

export type CatalogSelectionInput = Readonly<{
  odooAttributeId: OdooAttributeId;
  odooAttributeValueId: OdooAttributeValueId;
}>;

export type CatalogProjectionRevision = Readonly<{
  recordId: string;
  sourceFingerprint: string;
  sourceRevision: SourceRevision;
}>;

export type CreateCatalogProjectionChange = Readonly<{
  tag: "create";
  sync: CatalogProjectionRevision;
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
  sourceAvailable: boolean;
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
  odooAttributeValueId: OdooAttributeValueId;
  odooTemplateAttributeValueId: OdooTemplateAttributeValueId;
  sourceLabel: string;
  medusaProductOptionValueId: string | null;
}>;

export type UpdateCatalogValueChange = ExistingCatalogValueUpdate | NewCatalogValueSeed;

export type UpdateCatalogAttributeChange = Readonly<{
  mappingId: string;
  odooAttributeId: OdooAttributeId;
  sourceLabel: string;
  values: readonly UpdateCatalogValueChange[];
}>;

export type UpdateCatalogProjectionChange = Readonly<{
  tag: "update";
  sync: CatalogProjectionRevision;
  template: Readonly<{
    mappingId: string;
    sourceLabel: string;
    sourceAvailable: boolean;
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
  odooIntegrationKey: OdooIntegrationKey;
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
  source_available: boolean;
  approval_state: CatalogVariantApprovalState;
  storefront_available: boolean;
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
  createdAttributeIds: readonly string[];
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

export type CatalogProjectionStatus = Readonly<{
  mapped: boolean;
  sourceAvailable: boolean | null;
  syncResolved: boolean;
}>;

export type CatalogVariantApprovalSnapshot = Readonly<{
  id: string;
  approvalState: CatalogVariantApprovalState;
  storefrontAvailable: boolean;
}>;

export type CatalogVariantAvailability = Readonly<{
  medusaVariantId: string;
  sourceAvailable: boolean;
  approvalState: CatalogVariantApprovalState;
  storefrontAvailable: boolean;
}>;

export type CatalogAvailabilityProjection = Readonly<{
  productAvailable: boolean;
  unavailableVariantIds: readonly string[];
  previous: readonly CatalogStorefrontAvailabilitySnapshot[];
}>;

export type CatalogStorefrontAvailabilitySnapshot = Readonly<{
  id: string;
  storefrontAvailable: boolean;
}>;

export type CatalogProjectionRecords = Readonly<{
  template: CatalogProjectionMappingRecord;
  mappings: readonly CatalogProjectionMappingRecord[];
  attributes: readonly CatalogProjectionAttributeRecord[];
  values: readonly CatalogProjectionValueRecord[];
  selections: readonly CatalogProjectionSelectionRecord[];
}>;

type CatalogProjectionMappingRecord = Readonly<{
  id: string;
  odoo_model: OdooCatalogModel;
  odoo_database_id: number;
  odoo_integration_key: string;
  source_revision_changed_at: string;
  source_fingerprint: string;
  source_label: string;
  source_internal_reference: string | null;
  source_barcode: string | null;
  medusa_product_id: string;
  medusa_variant_id: string | null;
  source_available: boolean;
  approval_state: CatalogVariantApprovalState;
  storefront_available: boolean;
}>;

type CatalogProjectionAttributeRecord = Readonly<{
  id: string;
  odoo_attribute_id: number;
  variant_creation_mode: OdooAttributeMode;
  source_label: string;
  medusa_product_option_id: string | null;
}>;

type CatalogProjectionValueRecord = Readonly<{
  id: string;
  catalog_attribute_mapping_id: string;
  odoo_attribute_value_id: number;
  odoo_template_attribute_value_id: number;
  source_label: string;
  medusa_product_option_value_id: string | null;
}>;

type CatalogProjectionSelectionRecord = Readonly<{
  id: string;
  variant_catalog_mapping_id: string;
  catalog_attribute_mapping_id: string;
  catalog_attribute_value_mapping_id: string;
}>;

export type CatalogVariantDisposition =
  | "created"
  | "updated"
  | "unchanged"
  | "archived"
  | "reactivated";

export type CatalogVariantSynchronization = Readonly<{
  integrationKey: OdooIntegrationKey;
  odooVariantId: OdooVariantId;
  medusaVariantId: string;
  catalogMappingId: string;
  disposition: CatalogVariantDisposition;
  sourceAvailable: boolean;
  approvalState: CatalogVariantApprovalState;
}>;
