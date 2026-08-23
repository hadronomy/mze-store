import { MedusaError } from "@medusajs/framework/utils";
import type { AuthoringErrorCode } from "./types";

// Every promotion gate maps to invalid_data on purpose: Medusa's error
// handler replaces the code of conflict-class errors with a generic
// idempotency message, and an Operator needs the failing gate named in the
// response. Unknown products stay not_found.
const AUTHORING_ERROR_TYPES = {
  authoring_product_unmapped: MedusaError.Types.INVALID_DATA,
  authoring_price_invalid: MedusaError.Types.INVALID_DATA,
  authoring_editorial_incomplete: MedusaError.Types.INVALID_DATA,
  authoring_media_missing: MedusaError.Types.INVALID_DATA,
  authoring_sync_unresolved: MedusaError.Types.INVALID_DATA,
  authoring_state_conflict: MedusaError.Types.INVALID_DATA,
  authoring_product_unknown: MedusaError.Types.NOT_FOUND,
} as const satisfies Record<AuthoringErrorCode, MedusaError["type"]>;

export function authoringError(code: AuthoringErrorCode, message: string): MedusaError {
  return new MedusaError(AUTHORING_ERROR_TYPES[code], message, code);
}
