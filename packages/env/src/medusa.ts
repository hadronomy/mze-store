import type { z } from "zod";
import { type EnvironmentSource, medusaEnvironmentSchema } from "./schemas";

/**
 * Validates values after Medusa loads its environment file.
 * `SKIP_ENV_VALIDATION` returns the source unchanged for build-only config evaluation.
 */
export function parse(source: EnvironmentSource) {
  if (source.SKIP_ENV_VALIDATION) {
    return source as z.infer<typeof medusaEnvironmentSchema>;
  }

  return medusaEnvironmentSchema.parse(source);
}
