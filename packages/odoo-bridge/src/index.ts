export {
  ODOO_BRIDGE_ERROR_CODES,
  OdooBridgeClient,
  OdooBridgeError,
  isPrivateOdooEndpoint,
} from "./client";
export type { OdooBridgeErrorCode, OdooReadOnlyContract, OdooRequest } from "./client";
export {
  ODOO_BRIDGE_METHOD,
  ODOO_BRIDGE_MODEL,
  ODOO_CATALOG_CONTRACT_VERSION,
  OdooBridgeConfigSchema,
  OdooCatalogBatchRequestSchema,
  OdooCatalogBatchSchema,
  OdooCatalogCursorSchema,
  OdooCatalogItemSchema,
  OdooDocumentationIndexSchema,
  OdooModelDocumentationSchema,
} from "./contract";
export type {
  OdooBridgeConfig,
  OdooCatalogBatch,
  OdooCatalogBatchRequest,
  OdooCatalogCursor,
  OdooCatalogItem,
  OdooCatalogVariant,
  OdooCatalogTemplate,
  OdooDocumentationIndex,
  OdooModelDocumentation,
} from "./contract";
