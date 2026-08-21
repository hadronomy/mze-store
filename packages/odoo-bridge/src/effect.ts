export * from "./contract";
export {
  AmbiguousCatalogIdentity,
  AuthenticationFailed,
  BridgeContractMissing,
  BridgeContractNotModel,
  BridgeContractNotReadonly,
  CatalogFixtureEmpty,
  InvalidApiKey,
  InvalidCatalogBatchInput,
  InvalidCatalogBatchResponse,
  InvalidDatabase,
  InvalidDocumentationIndexResponse,
  InvalidModelDocumentationResponse,
  InvalidRequestTimeout,
  OdooRequestRejected,
  PermissionDenied,
  PrivateOdooRouteRequired,
  RequestTimedOut,
  TransportFailed,
  UnexpectedStatus,
} from "./error";
export type {
  CheckContractError,
  ConfigurationError,
  InvalidResponseError,
  ReadCatalogBatchError,
  RequestError,
} from "./error";
export { OdooBridge } from "./odoo-bridge";
