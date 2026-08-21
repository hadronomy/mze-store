import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260821153000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table if not exists "sync_record" ("id" text not null, "operation_id" text not null, "request_fingerprint" text not null, "response_fingerprint" text null, "state" text check ("state" in (\'pending\', \'in_progress\', \'succeeded\', \'failed\', \'dead_letter\', \'archived\')) not null, "attempts" integer not null default 0, "source_template_integration_key" text null, "source_variant_integration_key" text null, "source_revision_changed_at" text null, "source_revision_product_id" integer null, "next_cursor_changed_at" text null, "next_cursor_product_id" integer null, "medusa_product_id" text null, "medusa_variant_id" text null, "template_catalog_mapping_id" text null, "variant_catalog_mapping_id" text null, "error_type" text null, "error_code" text null, "error_message" text null, "started_at" timestamptz null, "finished_at" timestamptz null, "next_attempt_at" timestamptz null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "sync_record_pkey" primary key ("id"));',
    );
    this.addSql(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_sync_record_operation_id_unique" ON "sync_record" ("operation_id") WHERE deleted_at IS NULL;',
    );
    this.addSql(
      'CREATE INDEX IF NOT EXISTS "IDX_sync_record_state_next_attempt_at" ON "sync_record" ("state", "next_attempt_at") WHERE deleted_at IS NULL;',
    );

    this.addSql(
      'create table if not exists "catalog_mapping" ("id" text not null, "odoo_model" text check ("odoo_model" in (\'product.product\', \'product.template\')) not null, "odoo_database_id" integer not null, "odoo_integration_key" text not null, "source_revision_changed_at" text not null, "source_revision_product_id" integer not null, "source_fingerprint" text not null, "medusa_product_id" text not null, "medusa_variant_id" text null, "last_sync_record_id" text not null, "sync_state" text check ("sync_state" in (\'pending\', \'in_progress\', \'succeeded\', \'failed\', \'dead_letter\', \'archived\')) not null, "archived" boolean not null default false, "last_synced_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "catalog_mapping_pkey" primary key ("id"));',
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
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "catalog_mapping" cascade;');
    this.addSql('drop table if exists "sync_record" cascade;');
  }
}
