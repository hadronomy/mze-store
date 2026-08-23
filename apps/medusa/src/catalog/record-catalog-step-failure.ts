import type { Logger, MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils";
import { CATALOG_SYNC_MODULE, type CatalogSyncModule } from "~/modules/catalog-sync";

export async function recordCatalogStepFailure(
  container: MedusaContainer,
  syncRecordId: string,
  error: Error,
): Promise<Error> {
  const catalogSync = container.resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
  try {
    await catalogSync.failSyncIfActive(
      syncRecordId,
      MedusaError.isMedusaError(error)
        ? { type: error.type, code: error.code ?? null, message: error.message }
        : {
            type: MedusaError.Types.UNEXPECTED_STATE,
            code: "catalog_import_failed",
            message: "The Catalog synchronization failed because of an internal error.",
          },
    );
  } catch (recordError) {
    const logger = container.resolve<Logger>(ContainerRegistrationKeys.LOGGER);
    const message =
      recordError instanceof Error
        ? recordError.message
        : "The failure recorder threw a value that was not an Error.";
    logger.error(`Could not record failure for Catalog Sync Record ${syncRecordId}: ${message}`);
  }

  return error;
}
