import { model } from "@medusajs/framework/utils";

const CatalogVariantAttributeValue = model
  .define("catalog_variant_attribute_value", {
    id: model.id({ prefix: "catvarval" }).primaryKey(),
    variant_catalog_mapping_id: model.text(),
    catalog_attribute_mapping_id: model.text(),
    catalog_attribute_value_mapping_id: model.text(),
    last_sync_record_id: model.text(),
    last_synced_at: model.dateTime(),
  })
  .indexes([
    {
      name: "IDX_catalog_variant_attribute_unique",
      on: ["variant_catalog_mapping_id", "catalog_attribute_mapping_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_catalog_variant_attribute_value_unique",
      on: ["variant_catalog_mapping_id", "catalog_attribute_value_mapping_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
  ]);

export default CatalogVariantAttributeValue;
