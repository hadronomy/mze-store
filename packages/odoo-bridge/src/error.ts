import { Schema } from "effect";

export class InvalidApiKey extends Schema.TaggedError<InvalidApiKey>()("InvalidApiKey", {}) {
  override get message(): string {
    return "The Odoo API key must not be empty.";
  }
}

export class InvalidDatabase extends Schema.TaggedError<InvalidDatabase>()("InvalidDatabase", {}) {
  override get message(): string {
    return "The Odoo database must not be empty.";
  }
}

export class InvalidRequestTimeout extends Schema.TaggedError<InvalidRequestTimeout>()(
  "InvalidRequestTimeout",
  {},
) {
  override get message(): string {
    return "The Odoo request timeout must be finite and greater than zero.";
  }
}

export class PrivateOdooRouteRequired extends Schema.TaggedError<PrivateOdooRouteRequired>()(
  "PrivateOdooRouteRequired",
  {},
) {
  override get message(): string {
    return "The Odoo base URL must use the Private Odoo Route.";
  }
}

export class InvalidCatalogBatchInput extends Schema.TaggedError<InvalidCatalogBatchInput>()(
  "InvalidCatalogBatchInput",
  {},
) {
  override get message(): string {
    return "The Catalog Batch input is invalid.";
  }
}

export class AuthenticationFailed extends Schema.TaggedError<AuthenticationFailed>()(
  "AuthenticationFailed",
  { status: Schema.Literal(401) },
) {
  override get message(): string {
    return "Odoo rejected the Service User API key.";
  }
}

export class PermissionDenied extends Schema.TaggedError<PermissionDenied>()("PermissionDenied", {
  status: Schema.Literal(403),
}) {
  override get message(): string {
    return "The Service User cannot access the Odoo Bridge Contract.";
  }
}

export class UnexpectedStatus extends Schema.TaggedError<UnexpectedStatus>()("UnexpectedStatus", {
  status: Schema.Int,
}) {
  override get message(): string {
    return `Odoo returned unexpected HTTP status ${this.status}.`;
  }
}

export class RequestTimedOut extends Schema.TaggedError<RequestTimedOut>()("RequestTimedOut", {}) {
  override get message(): string {
    return "The Odoo request exceeded its timeout.";
  }
}

export class TransportFailed extends Schema.TaggedError<TransportFailed>()("TransportFailed", {}) {
  override get message(): string {
    return "The Odoo request failed before it received a response.";
  }
}

export class InvalidCatalogBatchResponse extends Schema.TaggedError<InvalidCatalogBatchResponse>()(
  "InvalidCatalogBatchResponse",
  {},
) {
  override get message(): string {
    return "The Odoo Catalog Batch response does not match its schema.";
  }
}

export class InvalidDocumentationIndexResponse extends Schema.TaggedError<InvalidDocumentationIndexResponse>()(
  "InvalidDocumentationIndexResponse",
  {},
) {
  override get message(): string {
    return "The Odoo documentation index does not match its schema.";
  }
}

export class InvalidModelDocumentationResponse extends Schema.TaggedError<InvalidModelDocumentationResponse>()(
  "InvalidModelDocumentationResponse",
  {},
) {
  override get message(): string {
    return "The Odoo model documentation does not match its schema.";
  }
}

export class BridgeContractMissing extends Schema.TaggedError<BridgeContractMissing>()(
  "BridgeContractMissing",
  { part: Schema.Literals(["method", "model", "module"]) },
) {
  override get message(): string {
    return `The Odoo Bridge Contract ${this.part} is missing.`;
  }
}

export class BridgeContractNotModel extends Schema.TaggedError<BridgeContractNotModel>()(
  "BridgeContractNotModel",
  {},
) {
  override get message(): string {
    return "The Odoo Bridge Contract method is not a model method.";
  }
}

export class BridgeContractNotReadonly extends Schema.TaggedError<BridgeContractNotReadonly>()(
  "BridgeContractNotReadonly",
  {},
) {
  override get message(): string {
    return "The Odoo Bridge Contract method is not read-only.";
  }
}

export class CatalogFixtureEmpty extends Schema.TaggedError<CatalogFixtureEmpty>()(
  "CatalogFixtureEmpty",
  {},
) {
  override get message(): string {
    return "The Odoo Bridge Contract returned an empty catalog fixture.";
  }
}

export class OdooBridgeCallAborted extends Schema.TaggedError<OdooBridgeCallAborted>()(
  "OdooBridgeCallAborted",
  {},
) {
  override get message(): string {
    return "The caller aborted the Odoo bridge call.";
  }
}

export class OdooBridgeClientClosed extends Schema.TaggedError<OdooBridgeClientClosed>()(
  "OdooBridgeClientClosed",
  {},
) {
  override get message(): string {
    return "The Odoo bridge client is closed.";
  }
}

export type ConfigurationError =
  | InvalidApiKey
  | InvalidDatabase
  | InvalidRequestTimeout
  | PrivateOdooRouteRequired;

export type RequestError =
  | AuthenticationFailed
  | PermissionDenied
  | RequestTimedOut
  | TransportFailed
  | UnexpectedStatus;

export type InvalidResponseError =
  | InvalidCatalogBatchResponse
  | InvalidDocumentationIndexResponse
  | InvalidModelDocumentationResponse;

export type ReadCatalogBatchError =
  | InvalidCatalogBatchInput
  | InvalidCatalogBatchResponse
  | RequestError;

export type CheckContractError =
  | BridgeContractMissing
  | BridgeContractNotModel
  | BridgeContractNotReadonly
  | CatalogFixtureEmpty
  | InvalidCatalogBatchResponse
  | InvalidDocumentationIndexResponse
  | InvalidModelDocumentationResponse
  | RequestError;

export type CallError = OdooBridgeCallAborted | OdooBridgeClientClosed;

export type OdooBridgeError =
  | CallError
  | CheckContractError
  | ConfigurationError
  | ReadCatalogBatchError;

const OdooBridgeErrorSchema = Schema.Union([
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
  OdooBridgeCallAborted,
  OdooBridgeClientClosed,
  PermissionDenied,
  PrivateOdooRouteRequired,
  RequestTimedOut,
  TransportFailed,
  UnexpectedStatus,
]);

export const isOdooBridgeError = Schema.is(OdooBridgeErrorSchema);
