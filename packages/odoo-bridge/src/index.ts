export { Result } from "effect";

export { createOdooBridge } from "./client";
export type {
  CallOptions,
  CheckContractResult,
  CreateOdooBridgeResult,
  OdooBridgeAsyncResult,
  OdooBridgeClient,
  OdooBridgeGateway,
  OdooBridgeResult,
  Options,
  ReadCatalogBatchOptions,
  ReadCatalogBatchResult,
} from "./client";
export {
  ODOO_BRIDGE_METHOD,
  ODOO_BRIDGE_MODEL,
  ODOO_BRIDGE_MODULE,
  ODOO_CATALOG_CONTRACT_VERSION,
} from "./contract";
export type {
  BridgeContractCheck,
  CatalogAttribute,
  CatalogAttributeValue,
  CatalogBatch,
  CatalogBatchInput,
  CatalogItem,
  CatalogMediaReference,
  CatalogPriceList,
  CatalogRecordReference,
  CatalogTemplate,
  CatalogTax,
  CatalogVariant,
  CatalogVariantAttributeValue,
  OdooAttributeId,
  OdooAttributeValueId,
  OdooIntegrationKey,
  OdooPriceListId,
  OdooPriceRuleId,
  OdooProductId,
  OdooTaxId,
  OdooTemplateAttributeValueId,
  OdooVariantId,
  SourceRevision,
} from "./contract";
export * from "./error";
