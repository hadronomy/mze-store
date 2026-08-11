import { model } from "@medusajs/framework/utils";

const TaxRateChange = model
  .define("tax_rate_change", {
    id: model.id({ prefix: "trc" }).primaryKey(),
    operation_id: model.text().unique(),
    action: model.text(),
    tax_rate_id: model.text(),
    tax_region_id: model.text(),
    country_code: model.text(),
    province_code: model.text().nullable(),
    tax_rate_name: model.text(),
    tax_rate_code: model.text().nullable(),
    before_rate: model.float().nullable(),
    after_rate: model.float().nullable(),
    actor_kind: model.text(),
    actor_id: model.text(),
    actor_email: model.text().nullable(),
    occurred_at: model.dateTime(),
  })
  .indexes([
    {
      name: "IDX_tax_rate_change_region_occurred_at",
      on: ["tax_region_id", "occurred_at"],
    },
    {
      name: "IDX_tax_rate_change_province_occurred_at",
      on: ["province_code", "occurred_at"],
    },
    {
      name: "IDX_tax_rate_change_actor_occurred_at",
      on: ["actor_id", "occurred_at"],
    },
    {
      name: "IDX_tax_rate_change_occurred_at",
      on: ["occurred_at"],
    },
  ]);

export default TaxRateChange;
