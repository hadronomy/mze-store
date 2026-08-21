import { Result, createOdooBridge, type OdooBridgeError } from "@mze-store/odoo-bridge";
import { ENV as RESOLVED } from "varlock/init-server";
import type { CoercedEnvSchema } from "../../env";

const ENV = RESOLVED as Readonly<CoercedEnvSchema>;

export default async function checkOdooContract() {
  const created = createOdooBridge({
    apiKey: ENV.ODOO_API_KEY,
    baseUrl: ENV.ODOO_BASE_URL,
    database: ENV.ODOO_DATABASE,
  });
  if (Result.isFailure(created)) {
    reportFailure(created.failure);
    return;
  }

  await using bridge = created.success;
  const checked = await bridge.checkContract();
  if (Result.isFailure(checked)) {
    reportFailure(checked.failure);
    return;
  }

  const contract = checked.success;
  const variantCount = contract.fixture.items.reduce(
    (total, item) => total + item.variants.length,
    0,
  );

  console.info(
    JSON.stringify({
      catalog_items: contract.fixture.items.length,
      contract_version: contract.contractVersion,
      method: `${contract.model}/${contract.method}`,
      variant_count: variantCount,
      status: "ok",
    }),
  );
}

function reportFailure(error: OdooBridgeError): void {
  console.error(`ODOO_ROLLOUT_BLOCKER ${error._tag}: ${error.message}`);
  process.exitCode = 1;
}

function reportDefect(): void {
  console.error("ODOO_ROLLOUT_BLOCKER unexpected defect.");
  process.exitCode = 1;
}

void checkOdooContract().catch(reportDefect);
