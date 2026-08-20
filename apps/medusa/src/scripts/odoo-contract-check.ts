import { OdooBridgeClient, OdooBridgeError } from "@mze-store/odoo-bridge";
import { ENV as RESOLVED } from "varlock/init-server";
import type { CoercedEnvSchema } from "../../env";

const ENV = RESOLVED as Readonly<CoercedEnvSchema>;

export default async function checkOdooContract() {
  try {
    const contract = await new OdooBridgeClient({
      apiKey: ENV.ODOO_API_KEY,
      baseUrl: ENV.ODOO_BASE_URL,
      database: ENV.ODOO_DATABASE,
    }).checkReadOnlyContract();

    const variantCount = contract.catalog.items.reduce(
      (total, item) => total + item.variants.length,
      0,
    );

    console.info(
      JSON.stringify({
        catalog_items: contract.catalog.items.length,
        contract_version: contract.catalog.contract_version,
        method: contract.method,
        variant_count: variantCount,
        status: "ok",
      }),
    );
  } catch (error) {
    if (error instanceof OdooBridgeError) {
      console.error(`ODOO_ROLLOUT_BLOCKER ${error.code}: ${error.message}`);
    } else {
      console.error("ODOO_ROLLOUT_BLOCKER unexpected failure.");
    }
    process.exitCode = 1;
  }
}

void checkOdooContract();
