import { model } from "@medusajs/framework/utils";
import { ODOO_ATTRIBUTE_MODES } from "~/modules/catalog-sync/types";
import CatalogMapping from "./catalog-mapping";
import CatalogAttributeValueMapping from "./catalog-attribute-value-mapping";
import CatalogVariantAttributeValue from "./catalog-variant-attribute-value";

const CatalogAttributeMapping = model
  .define("catalog_attribute_mapping", {
    id: model.id({ prefix: "catattr" }).primaryKey(),
    template_catalog_mapping: model.belongsTo(() => CatalogMapping, {
      mappedBy: "catalog_attribute_mappings",
      foreignKeyName: "template_catalog_mapping_id",
    }),
    odoo_attribute_id: model.number(),
    variant_creation_mode: model.enum([...ODOO_ATTRIBUTE_MODES]),
    source_label: model.text(),
    medusa_product_option_id: model.text().nullable(),
    last_sync_record_id: model.text(),
    last_synced_at: model.dateTime(),
    catalog_attribute_value_mappings: model.hasMany(() => CatalogAttributeValueMapping, {
      mappedBy: "catalog_attribute_mapping",
    }),
    catalog_variant_attribute_values: model.hasMany(() => CatalogVariantAttributeValue, {
      mappedBy: "catalog_attribute_mapping",
    }),
  })
  .cascades({
    delete: ["catalog_attribute_value_mappings", "catalog_variant_attribute_values"],
  })
  .indexes([
    {
      name: "IDX_catalog_attribute_source_unique",
      on: ["template_catalog_mapping_id", "odoo_attribute_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_catalog_attribute_option_unique",
      on: ["medusa_product_option_id"],
      unique: true,
      where: "medusa_product_option_id IS NOT NULL AND deleted_at IS NULL",
    },
  ]);

export default CatalogAttributeMapping;
