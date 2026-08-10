import type { z } from "zod";
import { databaseEnvironmentSchema, type EnvironmentSource } from "./schemas";

export function parse(source: EnvironmentSource): z.infer<typeof databaseEnvironmentSchema> {
  return databaseEnvironmentSchema.parse(source);
}
