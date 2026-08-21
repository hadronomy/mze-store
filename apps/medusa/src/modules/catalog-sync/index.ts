import { Module } from "@medusajs/framework/utils";
import CatalogSyncModuleService from "./service";
import { CATALOG_SYNC_MODULE } from "./types";

export { CATALOG_SYNC_MODULE };
export type {
  CatalogImportFailure,
  CatalogImportSource,
  CatalogSyncModuleOptions,
  CatalogSyncState,
  CompleteCatalogImportInput,
  CreateCatalogMappingInput,
  OdooCatalogModel,
} from "./types";

export default Module(CATALOG_SYNC_MODULE, {
  service: CatalogSyncModuleService,
});
