import { Module } from "@medusajs/framework/utils";
import CatalogSyncModuleService from "./service";
import { CATALOG_SYNC_MODULE } from "./types";

export { CATALOG_SYNC_MODULE };
export { catalogError } from "./errors";
export {
  CATALOG_SYNC_ERROR_CODES,
  CATALOG_SYNC_STATES,
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
  CatalogIdentity,
  CatalogMappingSeed,
  CatalogMappingSnapshot,
  CatalogProjectionChange,
  CatalogProjectionCommit,
  CatalogProjectionMappingRef,
  CatalogProjectionReceipt,
  CatalogSelectionInput,
  CatalogSource,
  CatalogSyncFailure,
  CatalogSyncModuleOptions,
  CatalogSyncOutcome,
  CatalogSyncSource,
  CatalogSyncStart,
  CatalogSyncState,
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
export type {
  CatalogAttributeMappingRecord,
  CatalogAttributeValueMappingRecord,
  CatalogMappingRecord,
  CatalogProjectionRecords,
  CatalogSyncModule,
  CatalogVariantAttributeValueRecord,
  SyncRecordRecord,
  default as CatalogSyncModuleService,
} from "./service";

export default Module(CATALOG_SYNC_MODULE, {
  service: CatalogSyncModuleService,
});
