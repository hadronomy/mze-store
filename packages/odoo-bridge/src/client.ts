import {
  ODOO_BRIDGE_METHOD,
  ODOO_BRIDGE_MODEL,
  OdooBridgeConfigSchema,
  OdooCatalogBatchSchema,
  OdooCatalogBatchRequestSchema,
  OdooDocumentationIndexSchema,
  OdooModelDocumentationSchema,
  type OdooBridgeConfig,
  type OdooCatalogBatch,
  type OdooCatalogBatchRequest,
  type OdooDocumentationIndex,
  type OdooModelDocumentation,
} from "./contract";
import type { ZodType } from "zod";

const PRIVATE_ENDPOINTS = new Set([
  "https://odoo.eden.mizonaecologica.es",
  "http://odoo.odoo.svc.cluster.local:8069",
]);

export const ODOO_BRIDGE_ERROR_CODES = [
  "private_endpoint_required",
  "documentation_unavailable",
  "bridge_method_missing",
  "bridge_method_not_readonly",
  "catalog_fixture_missing",
  "http_error",
  "invalid_response",
] as const;

export type OdooBridgeErrorCode = (typeof ODOO_BRIDGE_ERROR_CODES)[number];

export class OdooBridgeError extends Error {
  readonly code: OdooBridgeErrorCode;
  readonly status: number | undefined;

  constructor(code: OdooBridgeErrorCode, message: string, status?: number) {
    super(message);
    this.name = "OdooBridgeError";
    this.code = code;
    this.status = status;
  }
}

export type OdooRequest = (input: string, init: RequestInit) => Promise<Response>;

export type OdooReadOnlyContract = {
  readonly catalog: OdooCatalogBatch;
  readonly documentation: {
    readonly index: OdooDocumentationIndex;
    readonly model: OdooModelDocumentation;
  };
  readonly method: `${typeof ODOO_BRIDGE_MODEL}/${typeof ODOO_BRIDGE_METHOD}`;
};

export function isPrivateOdooEndpoint(input: string): boolean {
  try {
    const url = new URL(input);
    return (
      PRIVATE_ENDPOINTS.has(url.origin) &&
      url.username === "" &&
      url.password === "" &&
      (url.pathname === "" || url.pathname === "/") &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

export class OdooBridgeClient {
  private readonly baseUrl: string;
  private readonly database: string;
  private readonly apiKey: string;
  private readonly request: OdooRequest;

  constructor(config: OdooBridgeConfig, request: OdooRequest = globalThis.fetch) {
    const parsed = OdooBridgeConfigSchema.parse(config);
    if (!isPrivateOdooEndpoint(parsed.baseUrl)) {
      throw new OdooBridgeError(
        "private_endpoint_required",
        "ODOO_BASE_URL must use the private Odoo route or cluster service.",
      );
    }

    const baseUrl = new URL(parsed.baseUrl);
    baseUrl.pathname = baseUrl.pathname.replace(/\/$/u, "");
    this.baseUrl = baseUrl.toString().replace(/\/$/u, "");
    this.database = parsed.database;
    this.apiKey = parsed.apiKey;
    this.request = request;
  }

  async readDocumentationIndex(): Promise<OdooDocumentationIndex> {
    return this.getJson(
      "/doc-bearer/index.json",
      OdooDocumentationIndexSchema,
      "documentation index",
      "documentation_unavailable",
    );
  }

  async readModelDocumentation(): Promise<OdooModelDocumentation> {
    return this.getJson(
      `/doc-bearer/${encodeURIComponent(ODOO_BRIDGE_MODEL)}.json`,
      OdooModelDocumentationSchema,
      "bridge model documentation",
      "documentation_unavailable",
    );
  }

  async readCatalogBatch(request: OdooCatalogBatchRequest = {}): Promise<OdooCatalogBatch> {
    const input = OdooCatalogBatchRequestSchema.parse(request);
    return this.postJson(
      `/json/2/${ODOO_BRIDGE_MODEL}/${ODOO_BRIDGE_METHOD}`,
      input,
      OdooCatalogBatchSchema,
      "catalog batch",
    );
  }

  async checkReadOnlyContract(): Promise<OdooReadOnlyContract> {
    const index = await this.readDocumentationIndex();
    const model = await this.readModelDocumentation();
    const documentedModel = index.models.find(({ model: name }) => name === ODOO_BRIDGE_MODEL);

    if (!documentedModel?.methods.includes(ODOO_BRIDGE_METHOD)) {
      throw new OdooBridgeError(
        "bridge_method_missing",
        `Odoo does not document ${ODOO_BRIDGE_MODEL}/${ODOO_BRIDGE_METHOD}.`,
      );
    }

    if (model.model !== ODOO_BRIDGE_MODEL) {
      throw new OdooBridgeError(
        "bridge_method_missing",
        `Odoo model documentation is for ${model.model}, not ${ODOO_BRIDGE_MODEL}.`,
      );
    }

    if (!Object.hasOwn(model.methods, ODOO_BRIDGE_METHOD)) {
      throw new OdooBridgeError(
        "bridge_method_missing",
        `Odoo model documentation does not include ${ODOO_BRIDGE_METHOD}.`,
      );
    }

    if (!model.methods[ODOO_BRIDGE_METHOD]?.api?.includes("readonly")) {
      throw new OdooBridgeError(
        "bridge_method_not_readonly",
        `Odoo method ${ODOO_BRIDGE_MODEL}/${ODOO_BRIDGE_METHOD} is not read-only.`,
      );
    }

    const catalog = await this.readCatalogBatch({ limit: 1 });
    if (catalog.items.length === 0) {
      throw new OdooBridgeError(
        "catalog_fixture_missing",
        "Odoo catalog bridge returned no normalized fixture.",
      );
    }

    return {
      catalog,
      documentation: { index, model },
      method: `${ODOO_BRIDGE_MODEL}/${ODOO_BRIDGE_METHOD}`,
    };
  }

  private async getJson<T>(
    path: string,
    schema: ZodType<T>,
    operation: string,
    errorCode: "documentation_unavailable",
  ): Promise<T> {
    return this.requestJson("GET", path, undefined, schema, operation, errorCode);
  }

  private async postJson<T>(
    path: string,
    body: OdooCatalogBatchRequest,
    schema: ZodType<T>,
    operation: string,
  ): Promise<T> {
    return this.requestJson("POST", path, JSON.stringify(body), schema, operation, "http_error");
  }

  private async requestJson<T>(
    method: "GET" | "POST",
    path: string,
    body: string | undefined,
    schema: ZodType<T>,
    operation: string,
    errorCode: OdooBridgeErrorCode,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.request(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `bearer ${this.apiKey}`,
          "Cache-Control": "no-cache",
          "Content-Type": "application/json",
          "User-Agent": "mze-store/odoo-bridge",
          "X-Odoo-Database": this.database,
        },
        body,
      });
    } catch (error) {
      const reason = error instanceof Error ? ` ${this.redact(error.message)}` : "";
      throw new OdooBridgeError(errorCode, `Odoo ${operation} request failed.${reason}`);
    }

    if (!response.ok) {
      throw new OdooBridgeError(
        errorCode,
        `Odoo ${operation} request failed with HTTP ${response.status}.`,
        response.status,
      );
    }

    let payload: string;
    try {
      payload = await response.text();
    } catch (error) {
      const reason = error instanceof Error ? ` ${this.redact(error.message)}` : "";
      throw new OdooBridgeError(
        "invalid_response",
        `Odoo ${operation} response could not be read.${reason}`,
        response.status,
      );
    }

    try {
      return schema.parse(JSON.parse(payload));
    } catch (error) {
      const reason = error instanceof Error ? ` ${this.redact(error.message)}` : "";
      throw new OdooBridgeError(
        "invalid_response",
        `Odoo ${operation} response did not match the bridge contract.${reason}`,
        response.status,
      );
    }
  }

  private redact(message: string): string {
    return message.replaceAll(this.apiKey, "[redacted]");
  }
}
