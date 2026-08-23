import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260822120000 extends Migration {
  async up(): Promise<void> {
    this.addSql(
      'create table if not exists "product_authoring" ("id" text not null, "product_id" text not null, "state" text check ("state" in (\'imported\', \'authoring\', \'ready\', \'published\', \'blocked\')) not null, "seo_title" text null, "seo_description" text null, "colour" text null, "merchandising_rank" integer not null default 0, "blocked_reason" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "product_authoring_pkey" primary key ("id"));',
    );
    this.addSql(
      'CREATE UNIQUE INDEX IF NOT EXISTS "IDX_product_authoring_product_id_unique" ON "product_authoring" ("product_id") WHERE deleted_at IS NULL;',
    );
    this.addSql(
      'CREATE INDEX IF NOT EXISTS "IDX_product_authoring_state" ON "product_authoring" ("state") WHERE deleted_at IS NULL;',
    );
  }

  async down(): Promise<void> {
    this.addSql('drop table if exists "product_authoring" cascade;');
  }
}
