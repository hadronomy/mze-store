import type { ExecArgs } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { seedTerritoryProbe } from "../territory/probe";
import { seedSpanishTerritory } from "../territory/seed";

/**
 * CAUTION: Do not run this against a live store. It publishes a Product that a
 * Shopper sees and can buy. Use it on a development or a test database, where
 * something has to carry a price before you can read one back.
 */
export default async function seedProbe({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  const territory = await seedSpanishTerritory(container);
  const probe = await seedTerritoryProbe(container, territory);

  logger.info(`Probe Product: ${probe.productId}`);
  logger.info(`Publishable API key: ${probe.publishableKey}`);
  logger.info("This Product is published. Do not leave it in a live catalogue.");
}
