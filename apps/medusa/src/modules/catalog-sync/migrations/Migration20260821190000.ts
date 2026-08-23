import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260821190000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'alter table "catalog_mapping" add column "source_label" text not null default \'\';',
    );
    this.addSql('alter table "catalog_mapping" add column "source_internal_reference" text null;');
    this.addSql('alter table "catalog_mapping" add column "source_barcode" text null;');
    this.addSql('alter table "catalog_mapping" alter column "source_label" drop default;');

    this.addSql('alter table "sync_record" add column "result" jsonb null;');
    this.addSql(`
      update "sync_record"
      set "result" = jsonb_build_object(
        'syncRecordId', "id",
        'productId', "medusa_product_id",
        'templateCatalogMappingId', "template_catalog_mapping_id",
        'variants', jsonb_build_array(jsonb_build_object(
          'integrationKey', "source_variant_integration_key",
          'odooVariantId', coalesce((
            select "odoo_database_id"
            from "catalog_mapping"
            where "id" = "sync_record"."variant_catalog_mapping_id"
          ), 0),
          'medusaVariantId', "medusa_variant_id",
          'catalogMappingId', "variant_catalog_mapping_id",
          'disposition', 'created',
          'availability', 'available'
        )),
        'sourceRevision', jsonb_build_object(
          'changedAt', "source_revision_changed_at",
          'productId', "source_revision_product_id"
        ),
        'nextCursor', case
          when "next_cursor_changed_at" is null then null
          else jsonb_build_object(
            'changedAt', "next_cursor_changed_at",
            'productId', "next_cursor_product_id"
          )
        end
      )
      where "state" = 'succeeded';
    `);
    this.addSql('alter table "sync_record" drop column "source_variant_integration_key";');
    this.addSql('alter table "sync_record" drop column "medusa_variant_id";');
    this.addSql('alter table "sync_record" drop column "template_catalog_mapping_id";');
    this.addSql('alter table "sync_record" drop column "variant_catalog_mapping_id";');

    this.addSql(
      'create table if not exists "catalog_attribute_mapping" ("id" text not null, "template_catalog_mapping_id" text not null, "odoo_attribute_id" integer not null, "variant_creation_mode" text check ("variant_creation_mode" in (\'always\', \'dynamic\', \'never\')) not null, "source_label" text not null, "medusa_product_option_id" text null, "last_sync_record_id" text not null, "last_synced_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "catalog_attribute_mapping_pkey" primary key ("id"));',
    );
    this.addSql(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_catalog_attribute_source_unique" ON "catalog_attribute_mapping" ("template_catalog_mapping_id", "odoo_attribute_id") WHERE deleted_at IS NULL;',
    );
    this.addSql(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_catalog_attribute_option_unique" ON "catalog_attribute_mapping" ("medusa_product_option_id") WHERE medusa_product_option_id IS NOT NULL AND deleted_at IS NULL;',
    );

    this.addSql(
      'create table if not exists "catalog_attribute_value_mapping" ("id" text not null, "catalog_attribute_mapping_id" text not null, "odoo_attribute_value_id" integer not null, "odoo_template_attribute_value_id" integer not null, "source_label" text not null, "medusa_product_option_value_id" text null, "last_sync_record_id" text not null, "last_synced_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "catalog_attribute_value_mapping_pkey" primary key ("id"));',
    );
    this.addSql(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_catalog_attribute_value_source_unique" ON "catalog_attribute_value_mapping" ("catalog_attribute_mapping_id", "odoo_attribute_value_id") WHERE deleted_at IS NULL;',
    );
    this.addSql(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_catalog_template_attribute_value_unique" ON "catalog_attribute_value_mapping" ("odoo_template_attribute_value_id") WHERE deleted_at IS NULL;',
    );
    this.addSql(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_catalog_attribute_option_value_unique" ON "catalog_attribute_value_mapping" ("medusa_product_option_value_id") WHERE medusa_product_option_value_id IS NOT NULL AND deleted_at IS NULL;',
    );

    this.addSql(
      'create table if not exists "catalog_variant_attribute_value" ("id" text not null, "variant_catalog_mapping_id" text not null, "catalog_attribute_mapping_id" text not null, "catalog_attribute_value_mapping_id" text not null, "last_sync_record_id" text not null, "last_synced_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "catalog_variant_attribute_value_pkey" primary key ("id"));',
    );
    this.addSql(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_catalog_variant_attribute_unique" ON "catalog_variant_attribute_value" ("variant_catalog_mapping_id", "catalog_attribute_mapping_id") WHERE deleted_at IS NULL;',
    );
    this.addSql(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_catalog_variant_attribute_value_unique" ON "catalog_variant_attribute_value" ("variant_catalog_mapping_id", "catalog_attribute_value_mapping_id") WHERE deleted_at IS NULL;',
    );
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "catalog_variant_attribute_value" cascade;');
    this.addSql('drop table if exists "catalog_attribute_value_mapping" cascade;');
    this.addSql('drop table if exists "catalog_attribute_mapping" cascade;');

    this.addSql('alter table "sync_record" add column "source_variant_integration_key" text null;');
    this.addSql('alter table "sync_record" add column "medusa_variant_id" text null;');
    this.addSql('alter table "sync_record" add column "template_catalog_mapping_id" text null;');
    this.addSql('alter table "sync_record" add column "variant_catalog_mapping_id" text null;');
    this.addSql(`
      update "sync_record"
      set
        "source_variant_integration_key" = "result" #>> '{variants,0,integrationKey}',
        "medusa_variant_id" = "result" #>> '{variants,0,medusaVariantId}',
        "template_catalog_mapping_id" = "result" ->> 'templateCatalogMappingId',
        "variant_catalog_mapping_id" = "result" #>> '{variants,0,catalogMappingId}'
      where "result" is not null;
    `);
    this.addSql('alter table "sync_record" drop column "result";');

    this.addSql('alter table "catalog_mapping" drop column "source_barcode";');
    this.addSql('alter table "catalog_mapping" drop column "source_internal_reference";');
    this.addSql('alter table "catalog_mapping" drop column "source_label";');
  }
}
