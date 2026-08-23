import { model } from "@medusajs/framework/utils";
import { CATALOG_SYNC_STATES, ODOO_CATALOG_MODELS } from "~/modules/catalog-sync/types";
import CatalogAttributeMapping from "./catalog-attribute-mapping";
import CatalogVariantAttributeValue from "./catalog-variant-attribute-value";

const CatalogMapping = model
  .define("catalog_mapping", {
    id: model.id({ prefix: "catmap" }).primaryKey(),
    odoo_model: model.enum([...ODOO_CATALOG_MODELS]),
    odoo_database_id: model.number(),
    odoo_integration_key: model.text(),
    source_revision_changed_at: model.text(),
    source_revision_product_id: model.number(),
    source_fingerprint: model.text(),
    source_label: model.text(),
    source_internal_reference: model.text().nullable(),
    source_barcode: model.text().nullable(),
    medusa_product_id: model.text(),
    medusa_variant_id: model.text().nullable(),
    last_sync_record_id: model.text(),
    sync_state: model.enum([...CATALOG_SYNC_STATES]),
    archived: model.boolean().default(false),
    last_synced_at: model.dateTime(),
    catalog_attribute_mappings: model.hasMany(() => CatalogAttributeMapping, {
      mappedBy: "template_catalog_mapping",
    }),
    catalog_variant_attribute_values: model.hasMany(() => CatalogVariantAttributeValue, {
      mappedBy: "variant_catalog_mapping",
    }),
  })
  .cascades({
    // Hard deletes take the child rows with them. Soft-delete compensation
    // still deletes children explicitly and in order.
    delete: ["catalog_attribute_mappings", "catalog_variant_attribute_values"],
  })
  .indexes([
    {
      name: "IDX_catalog_mapping_integration_key_unique",
      on: ["odoo_integration_key"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_catalog_mapping_source_record_unique",
      on: ["odoo_model", "odoo_database_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
    {
      name: "IDX_catalog_mapping_product_unique",
      on: ["medusa_product_id"],
      unique: true,
      where: "odoo_model = 'product.template' AND deleted_at IS NULL",
    },
    {
      name: "IDX_catalog_mapping_variant_unique",
      on: ["medusa_variant_id"],
      unique: true,
      where: "medusa_variant_id IS NOT NULL AND deleted_at IS NULL",
    },
  ]);

export default CatalogMapping;
