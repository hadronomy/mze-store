import { model } from "@medusajs/framework/utils";
import { TAX_RATE_AUDIT_RESOURCE_KINDS } from "~/modules/tax-rate-audit/types";

const TaxRateAuditOperation = model
  .define("tax_rate_audit_operation", {
    id: model.id({ prefix: "traop" }).primaryKey(),
    operation_id: model.text(),
    request_fingerprint: model.text(),
    resource_kind: model.enum([...TAX_RATE_AUDIT_RESOURCE_KINDS]),
    resource_id: model.text(),
  })
  .indexes([
    {
      name: "IDX_tax_rate_audit_operation_id_unique",
      on: ["operation_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
  ]);

export default TaxRateAuditOperation;
