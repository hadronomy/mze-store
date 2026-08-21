import { MedusaError } from "@medusajs/framework/utils";
import type { Options as OdooBridgeOptions } from "@mze-store/odoo-bridge";
import type { CatalogSource } from "./types";

export async function createOdooCatalogSource(options: OdooBridgeOptions): Promise<CatalogSource> {
  const bridge = await loadOdooBridge();
  const result = bridge.createOdooBridge(options);
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
          ? bridge.decodeSourceRevision({
              write_date: cursor.changedAt,
              id: cursor.productId,
            })
          : null,
        limit,
        signal,
      }),
  };
}

function loadOdooBridge(): Promise<typeof import("@mze-store/odoo-bridge")> {
  // Medusa and Jest load this Adapter as CommonJS, while Effect is ESM-only.
  // Keep that interop detail at this boundary instead of spreading imports through the module.
  return import("@mze-store/odoo-bridge");
}
