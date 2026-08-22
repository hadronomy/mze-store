import { model } from "@medusajs/framework/utils";
import CatalogAttributeMapping from "./catalog-attribute-mapping";
import CatalogVariantAttributeValue from "./catalog-variant-attribute-value";

const CatalogAttributeValueMapping = model
  .define("catalog_attribute_value_mapping", {
    id: model.id({ prefix: "catval" }).primaryKey(),
    catalog_attribute_mapping: model.belongsTo(() => CatalogAttributeMapping, {
      mappedBy: "catalog_attribute_value_mappings",
      foreignKeyName: "catalog_attribute_mapping_id",
    }),
    odoo_attribute_value_id: model.number(),
    odoo_template_attribute_value_id: model.number(),
    source_label: model.text(),
    medusa_product_option_value_id: model.text().nullable(),
    last_sync_record_id: model.text(),
    last_synced_at: model.dateTime(),
    catalog_variant_attribute_values: model.hasMany(() => CatalogVariantAttributeValue, {
      mappedBy: "catalog_attribute_value_mapping",
    }),
  })
  .cascades({
    delete: ["catalog_variant_attribute_values"],
  })
  .indexes([
    {
      name: "IDX_catalog_attribute_value_source_unique",
      on: ["catalog_attribute_mapping_id", "odoo_attribute_value_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_catalog_template_attribute_value_unique",
      on: ["odoo_template_attribute_value_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_catalog_attribute_option_value_unique",
      on: ["medusa_product_option_value_id"],
      unique: true,
      where: "medusa_product_option_value_id IS NOT NULL AND deleted_at IS NULL",
    },
  ]);

export default CatalogAttributeValueMapping;
