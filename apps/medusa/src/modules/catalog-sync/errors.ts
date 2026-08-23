import { MedusaError } from "@medusajs/framework/utils";
import type { CatalogErrorCode, MedusaErrorType } from "./types";

const CATALOG_ERROR_TYPES = {
  catalog_bridge_configuration_invalid: MedusaError.Types.INVALID_ARGUMENT,
  catalog_import_cancelled: MedusaError.Types.INVALID_DATA,
  catalog_source_unavailable: MedusaError.Types.UNEXPECTED_STATE,
  catalog_source_rejected: MedusaError.Types.INVALID_DATA,
  catalog_source_empty: MedusaError.Types.INVALID_DATA,
  catalog_source_missing_variant: MedusaError.Types.CONFLICT,
  catalog_identity_conflict: MedusaError.Types.CONFLICT,
  catalog_structure_conflict: MedusaError.Types.CONFLICT,
  catalog_operation_conflict: MedusaError.Types.CONFLICT,
  catalog_operation_in_progress: MedusaError.Types.CONFLICT,
  catalog_projection_result_invalid: MedusaError.Types.UNEXPECTED_STATE,
  catalog_result_invalid: MedusaError.Types.UNEXPECTED_STATE,
  catalog_failure_record_invalid: MedusaError.Types.UNEXPECTED_STATE,
  catalog_import_failed: MedusaError.Types.UNEXPECTED_STATE,
  catalog_product_refetch_failed: MedusaError.Types.UNEXPECTED_STATE,
} as const satisfies Record<CatalogErrorCode, MedusaErrorType>;

export function catalogError(code: CatalogErrorCode, message: string): MedusaError {
  return new MedusaError(CATALOG_ERROR_TYPES[code], message, code);
}
