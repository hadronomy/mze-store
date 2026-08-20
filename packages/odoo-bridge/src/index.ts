export {
  ODOO_BRIDGE_ERROR_CODES,
  OdooBridge,
  OdooBridgeError,
  OdooTransport,
  isPrivateOdooEndpoint,
  layer,
  layerWithTransport,
  normalizeSettings,
  transportLayer,
} from "./effect";
export type {
  OdooBridgeErrorCode,
  OdooBridgeSettings,
  OdooBridgeContract,
  OdooCallOptions,
  OdooCatalogPage,
  OdooCatalogReadOptions,
  OdooCatalogSession,
  OdooReadOnlyContract,
  OdooRequest,
  OdooTransportRequest,
  OdooTransportResponse,
  OdooTransportContract,
  OdooJsonValue,
} from "./effect";
export * from "./contract";
