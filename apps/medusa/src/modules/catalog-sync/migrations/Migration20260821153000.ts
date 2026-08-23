import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260821153000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table if not exists "sync_record" ("id" text not null, "operation_id" text not null, "request_fingerprint" text not null, "response_fingerprint" text null, "state" text check ("state" in (\'pending\', \'in_progress\', \'succeeded\', \'failed\', \'dead_letter\', \'archived\')) not null, "attempts" integer not null default 0, "source_revision_changed_at" text null, "source_revision_product_id" integer null, "next_cursor_changed_at" text null, "next_cursor_product_id" integer null, "medusa_product_id" text null, "result" jsonb null, "error_type" text null, "error_code" text null, "error_message" text null, "started_at" timestamptz null, "finished_at" timestamptz null, "next_attempt_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "sync_record_pkey" primary key ("id"));',
    );
    this.addSql(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_sync_record_operation_id_unique" ON "sync_record" ("operation_id") WHERE deleted_at IS NULL;',
    );
    this.addSql(
      'CREATE INDEX IF NOT EXISTS "IDX_sync_record_state_next_attempt_at" ON "sync_record" ("state", "next_attempt_at") WHERE deleted_at IS NULL;',
    );
    this.addSql(
      'CREATE INDEX IF NOT EXISTS "IDX_sync_record_product_started_at" ON "sync_record" ("medusa_product_id", "started_at") WHERE medusa_product_id IS NOT NULL AND deleted_at IS NULL;',
    );

    this.addSql(
      'create table if not exists "catalog_mapping" ("id" text not null, "odoo_model" text check ("odoo_model" in (\'product.product\', \'product.template\')) not null, "odoo_database_id" integer not null, "odoo_integration_key" text not null, "source_revision_changed_at" text not null, "source_revision_product_id" integer not null, "source_fingerprint" text not null, "source_label" text not null, "source_internal_reference" text null, "source_barcode" text null, "medusa_product_id" text not null, "medusa_variant_id" text null, "last_sync_record_id" text not null, "source_available" boolean not null default false, "approval_state" text check ("approval_state" in (\'pending\', \'approved\')) not null default \'pending\', "storefront_available" boolean not null default false, "last_synced_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "catalog_mapping_pkey" primary key ("id"));',
    );
    this.addSql(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_catalog_mapping_integration_key_unique" ON "catalog_mapping" ("odoo_integration_key") WHERE deleted_at IS NULL;',
    );
    this.addSql(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_catalog_mapping_source_record_unique" ON "catalog_mapping" ("odoo_model", "odoo_database_id") WHERE deleted_at IS NULL;',
    );
    this.addSql(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_catalog_mapping_product_unique" ON "catalog_mapping" ("medusa_product_id") WHERE odoo_model = \'product.template\' AND deleted_at IS NULL;',
    );
    this.addSql(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_catalog_mapping_variant_unique" ON "catalog_mapping" ("medusa_variant_id") WHERE medusa_variant_id IS NOT NULL AND deleted_at IS NULL;',
    );

    this.addSql(
      'create table if not exists "catalog_attribute_mapping" ("id" text not null, "template_catalog_mapping_id" text not null, "odoo_attribute_id" integer not null, "variant_creation_mode" text check ("variant_creation_mode" in (\'always\', \'dynamic\', \'never\')) not null, "source_label" text not null, "medusa_product_option_id" text null, "last_sync_record_id" text not null, "last_synced_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "catalog_attribute_mapping_pkey" primary key ("id"), constraint "fk_catalog_attribute_mapping_template" foreign key ("template_catalog_mapping_id") references "catalog_mapping" ("id") on delete cascade);',
    );
    this.addSql(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_catalog_attribute_source_unique" ON "catalog_attribute_mapping" ("template_catalog_mapping_id", "odoo_attribute_id") WHERE deleted_at IS NULL;',
    );
    this.addSql(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_catalog_attribute_option_unique" ON "catalog_attribute_mapping" ("medusa_product_option_id") WHERE medusa_product_option_id IS NOT NULL AND deleted_at IS NULL;',
    );

    this.addSql(
      'create table if not exists "catalog_attribute_value_mapping" ("id" text not null, "catalog_attribute_mapping_id" text not null, "odoo_attribute_value_id" integer not null, "odoo_template_attribute_value_id" integer not null, "source_label" text not null, "medusa_product_option_value_id" text null, "last_sync_record_id" text not null, "last_synced_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "catalog_attribute_value_mapping_pkey" primary key ("id"), constraint "fk_catalog_attribute_value_mapping_attribute" foreign key ("catalog_attribute_mapping_id") references "catalog_attribute_mapping" ("id") on delete cascade);',
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
      'create table if not exists "catalog_variant_attribute_value" ("id" text not null, "variant_catalog_mapping_id" text not null, "catalog_attribute_mapping_id" text not null, "catalog_attribute_value_mapping_id" text not null, "last_sync_record_id" text not null, "last_synced_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "catalog_variant_attribute_value_pkey" primary key ("id"), constraint "fk_catalog_variant_attribute_value_variant" foreign key ("variant_catalog_mapping_id") references "catalog_mapping" ("id") on delete cascade, constraint "fk_catalog_variant_attribute_value_attribute" foreign key ("catalog_attribute_mapping_id") references "catalog_attribute_mapping" ("id") on delete cascade, constraint "fk_catalog_variant_attribute_value_value" foreign key ("catalog_attribute_value_mapping_id") references "catalog_attribute_value_mapping" ("id") on delete cascade);',
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
    this.addSql('drop table if exists "catalog_mapping" cascade;');
    this.addSql('drop table if exists "sync_record" cascade;');
  }
}
