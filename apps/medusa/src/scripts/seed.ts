import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { seedSpanishTerritory } from "../territory/seed";

/**
 * Creates the territory model, and nothing that a Shopper sees. This is safe
 * against any database. `seed-probe.ts` is the one that is not.
 */
export default async function seed({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  logger.info("Seeding the Spanish territory model...");

  const seeded = await seedSpanishTerritory(container);

  logger.info(`Region: ${seeded.regionId}`);
  logger.info("Done. The admin owns the rates from here. See src/territory/spain.ts.");
}
