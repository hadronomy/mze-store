import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { seedSpanishTerritory } from "../territory/seed";

export default async function seed({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  logger.info("Seeding the Spanish territory model...");

  const seeded = await seedSpanishTerritory(container);

  logger.info(`Region: ${seeded.regionId}`);
  logger.info(`Publishable API key: ${seeded.publishableKey}`);
  logger.info("Done. Tax rates are unconfirmed — see src/territory/spain.ts.");
}
