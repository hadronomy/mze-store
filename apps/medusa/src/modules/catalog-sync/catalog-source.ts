import { MedusaError } from "@medusajs/framework/utils";
import {
  createOdooBridge,
  type OdooBridgeClient,
  type OdooBridgeError,
  type Options as OdooBridgeOptions,
} from "@mze-store/odoo-bridge";
import type { CatalogBatch, SourceRevision } from "@mze-store/odoo-bridge";
import { catalogError } from "./errors";
import type { CatalogSource } from "./types";

class OdooBridgeCatalogSource implements CatalogSource {
  readonly #client: OdooBridgeClient;

  constructor(client: OdooBridgeClient) {
    this.#client = client;
  }

  async readNextCatalogItem(
    options: Readonly<{ cursor?: SourceRevision | null; signal?: AbortSignal }> = {},
  ): Promise<CatalogBatch> {
    const result = await this.#client.readCatalogBatch({
      cursor: options.cursor ?? null,
      limit: 1,
      signal: options.signal,
    });
    if (result._tag === "Failure") {
      throw bridgeReadError(result.failure);
    }

    return result.success;
  }

  close(): Promise<void> {
    return this.#client.close();
  }
}

function bridgeReadError(error: OdooBridgeError): MedusaError {
  switch (error._tag) {
    case "OdooBridgeCallAborted":
      return catalogError("catalog_import_cancelled", "The Catalog read was cancelled.");
    case "AmbiguousCatalogIdentity":
    case "InvalidCatalogBatchInput":
    case "InvalidCatalogBatchResponse":
      return catalogError("catalog_source_rejected", error.message);
    default:
      return catalogError("catalog_source_unavailable", "The Odoo Catalog source is unavailable.");
  }
}

export function createOdooCatalogSource(options: OdooBridgeOptions): CatalogSource {
  const result = createOdooBridge(options);
  if (result._tag === "Failure") {
    throw catalogError("catalog_bridge_configuration_invalid", result.failure.message);
  }

  return new OdooBridgeCatalogSource(result.success);
}
