import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys } from "@medusajs/framework/utils";
import { seedTerritory } from "../territory/seed";
import { SPAIN_DECLARATION } from "../territory/spain";

/**
 * Puts the Spanish territory model in the database on the deploy that first
 * carries it.
 *
 * `medusa db:migrate` runs this, so a deployment needs no extra step and no
 * second boot of the application. Medusa records the file name in
 * `script_migrations` and never runs it again. A script that throws is not
 * recorded, so the next `db:migrate` tries it again.
 *
 * CAUTION: The file name is the record. Renaming this file runs it a second
 * time against every database that already has it.
 *
 * A later change to the model is a new file beside this one, and not an edit
 * here. That is the trade this mechanism makes: the history is append-only and
 * auditable, and nothing reaches back over an Operator who has since changed
 * the model in the admin.
 */
export default async function createSpanishTerritory({
  container,
}: {
  container: MedusaContainer;
}) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER);

  const seeded = await seedTerritory(container, SPAIN_DECLARATION);

  logger.info(`Spanish territory model ready. Region: ${seeded.regionId}`);
}
