import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260811120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table if not exists "tax_rate_audit_operation" ("id" text not null, "operation_id" text not null, "request_fingerprint" text not null, "resource_kind" text check ("resource_kind" in (\'tax_rate\', \'tax_region\')) not null, "resource_id" text not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tax_rate_audit_operation_pkey" primary key ("id"));',
    );
    this.addSql(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tax_rate_audit_operation_id_unique" ON "tax_rate_audit_operation" ("operation_id") WHERE deleted_at IS NULL;',
    );
    this.addSql(
      'create table if not exists "tax_rate_change" ("id" text not null, "operation_id" text not null, "request_fingerprint" text not null, "action" text check ("action" in (\'created\', \'updated\')) not null, "tax_rate_id" text not null, "tax_region_id" text not null, "country_code" text not null, "province_code" text null, "tax_rate_name" text not null, "tax_rate_code" text null, "before_rate" real null, "after_rate" real null, "actor_kind" text check ("actor_kind" in (\'operator\', \'system\')) not null, "actor_id" text not null, "actor_email" text null, "occurred_at" timestamptz not null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "tax_rate_change_pkey" primary key ("id"));',
    );
    this.addSql(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tax_rate_change_operation_id_unique" ON "tax_rate_change" ("operation_id") WHERE deleted_at IS NULL;',
    );
    this.addSql(
      'CREATE INDEX IF NOT EXISTS "IDX_tax_rate_change_region_occurred_at" ON "tax_rate_change" ("tax_region_id", "occurred_at");',
    );
    this.addSql(
      'CREATE INDEX IF NOT EXISTS "IDX_tax_rate_change_province_occurred_at" ON "tax_rate_change" ("province_code", "occurred_at");',
    );
    this.addSql(
      'CREATE INDEX IF NOT EXISTS "IDX_tax_rate_change_actor_occurred_at" ON "tax_rate_change" ("actor_id", "occurred_at");',
    );
    this.addSql(
      'CREATE INDEX IF NOT EXISTS "IDX_tax_rate_change_occurred_at" ON "tax_rate_change" ("occurred_at");',
    );
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "tax_rate_change" cascade;');
    this.addSql('drop table if exists "tax_rate_audit_operation" cascade;');
  }
}
