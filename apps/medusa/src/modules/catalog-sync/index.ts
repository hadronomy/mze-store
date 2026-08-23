import { Module } from "@medusajs/framework/utils";
import CatalogSyncModuleService from "./service";
import { CATALOG_SYNC_MODULE } from "./types";

export { CATALOG_SYNC_MODULE };
export { catalogError } from "./errors";
export {
  CATALOG_SYNC_ERROR_CODES,
  CATALOG_SOURCE_RETRYABILITY,
  CATALOG_SYNC_STATES,
  CATALOG_VARIANT_APPROVAL_STATES,
  ODOO_ATTRIBUTE_MODES,
  ODOO_CATALOG_MODELS,
} from "./types";
export { CatalogSynchronizationResultSchema } from "./schema";
export type {
  BeginCatalogSyncInput,
  CatalogAttributeSeed,
  CatalogAttributeSnapshot,
  CatalogAttributeValueSeed,
  CatalogErrorCode,
  CatalogSourceFailureCode,
  CatalogIdentity,
  CatalogMappingSeed,
  CatalogMappingSnapshot,
  CatalogProjectionChange,
  CatalogProjectionCommit,
  CatalogProjectionMappingRef,
  CatalogProjectionReceipt,
  CatalogProjectionStatus,
  CatalogSelectionInput,
  CatalogAvailabilityProjection,
  CatalogStorefrontAvailabilitySnapshot,
  CatalogSyncFailure,
  CatalogSyncModuleOptions,
  CatalogSyncOutcome,
  CatalogSyncSource,
  CatalogSyncStart,
  CatalogSyncState,
  CatalogVariantApprovalSnapshot,
  CatalogVariantApprovalState,
  CatalogVariantAvailability,
  CatalogValueSnapshot,
  CreateCatalogProjectionChange,
  MedusaErrorType,
  OdooAttributeMode,
  OdooCatalogModel,
  TouchCatalogProjectionChange,
  UpdateCatalogProjectionChange,
  UpdateCatalogValueChange,
} from "./types";
export type { CatalogSynchronizationResult } from "./schema";
export type { CatalogSyncModule } from "./service";

export default Module(CATALOG_SYNC_MODULE, {
  service: CatalogSyncModuleService,
});
