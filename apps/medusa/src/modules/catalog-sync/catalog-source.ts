import { MedusaError } from "@medusajs/framework/utils";
import {
  createOdooBridge,
  decodeSourceRevision,
  type Options as OdooBridgeOptions,
} from "@mze-store/odoo-bridge";
import type { CatalogSource } from "./types";

export function createOdooCatalogSource(options: OdooBridgeOptions): CatalogSource {
  const result = createOdooBridge(options);
  if (result._tag === "Failure") {
    throw new MedusaError(
      MedusaError.Types.INVALID_ARGUMENT,
      result.failure.message,
      "catalog_bridge_configuration_invalid",
    );
  }

  const client = result.success;
  return {
    close: () => client.close(),
    readCatalogBatch: ({ cursor, limit, signal }) =>
      client.readCatalogBatch({
        cursor: cursor
          ? decodeSourceRevision({
              write_date: cursor.changedAt,
              id: cursor.productId,
            })
          : null,
        limit,
        signal,
      }),
  };
}
