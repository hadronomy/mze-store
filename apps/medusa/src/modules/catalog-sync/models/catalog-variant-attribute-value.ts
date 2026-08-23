import { model } from "@medusajs/framework/utils";
import CatalogMapping from "./catalog-mapping";
import CatalogAttributeMapping from "./catalog-attribute-mapping";
import CatalogAttributeValueMapping from "./catalog-attribute-value-mapping";

const CatalogVariantAttributeValue = model
  .define("catalog_variant_attribute_value", {
    id: model.id({ prefix: "catvarval" }).primaryKey(),
    variant_catalog_mapping: model.belongsTo(() => CatalogMapping, {
      mappedBy: "catalog_variant_attribute_values",
      foreignKeyName: "variant_catalog_mapping_id",
    }),
    catalog_attribute_mapping: model.belongsTo(() => CatalogAttributeMapping, {
      mappedBy: "catalog_variant_attribute_values",
      foreignKeyName: "catalog_attribute_mapping_id",
    }),
    catalog_attribute_value_mapping: model.belongsTo(() => CatalogAttributeValueMapping, {
      mappedBy: "catalog_variant_attribute_values",
      foreignKeyName: "catalog_attribute_value_mapping_id",
    }),
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
