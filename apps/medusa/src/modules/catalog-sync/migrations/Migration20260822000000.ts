import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260822000000 extends Migration {
  async up(): Promise<void> {
    // Fold the template Integration Key into the stored result before the
    // column goes away, so every stored result carries one contract.
    this.addSql(`
      update "sync_record"
      set "result" = jsonb_set(
        "result",
        '{templateIntegrationKey}',
        to_jsonb("source_template_integration_key")
      )
      where "state" = 'succeeded'
        and "result" is not null
        and "source_template_integration_key" is not null;
    `);
    this.addSql(
      'alter table "sync_record" drop column if exists "source_template_integration_key";',
    );

    // Real foreign keys for the projection graph. Cascades cover hard
    // deletes; soft-delete compensation still removes children explicitly
    // and in order, so history policy stays explicit.
    this.addSql(
      'alter table "catalog_attribute_mapping" add constraint "fk_catalog_attribute_mapping_template" foreign key ("template_catalog_mapping_id") references "catalog_mapping" ("id") on delete cascade;',
    );
    this.addSql(
      'alter table "catalog_attribute_value_mapping" add constraint "fk_catalog_attribute_value_mapping_attribute" foreign key ("catalog_attribute_mapping_id") references "catalog_attribute_mapping" ("id") on delete cascade;',
    );
    this.addSql(
      'alter table "catalog_variant_attribute_value" add constraint "fk_catalog_variant_attribute_value_variant" foreign key ("variant_catalog_mapping_id") references "catalog_mapping" ("id") on delete cascade;',
    );
    this.addSql(
      'alter table "catalog_variant_attribute_value" add constraint "fk_catalog_variant_attribute_value_attribute" foreign key ("catalog_attribute_mapping_id") references "catalog_attribute_mapping" ("id") on delete cascade;',
    );
    this.addSql(
      'alter table "catalog_variant_attribute_value" add constraint "fk_catalog_variant_attribute_value_value" foreign key ("catalog_attribute_value_mapping_id") references "catalog_attribute_value_mapping" ("id") on delete cascade;',
    );
  }

  async down(): Promise<void> {
    this.addSql(
      'alter table "catalog_variant_attribute_value" drop constraint if exists "fk_catalog_variant_attribute_value_value";',
    );
    this.addSql(
      'alter table "catalog_variant_attribute_value" drop constraint if exists "fk_catalog_variant_attribute_value_attribute";',
    );
    this.addSql(
      'alter table "catalog_variant_attribute_value" drop constraint if exists "fk_catalog_variant_attribute_value_variant";',
    );
    this.addSql(
      'alter table "catalog_attribute_value_mapping" drop constraint if exists "fk_catalog_attribute_value_mapping_attribute";',
    );
    this.addSql(
      'alter table "catalog_attribute_mapping" drop constraint if exists "fk_catalog_attribute_mapping_template";',
    );

    this.addSql(
      'alter table "sync_record" add column "source_template_integration_key" text null;',
    );
    this.addSql(`
      update "sync_record"
      set "source_template_integration_key" = "result" #>> '{templateIntegrationKey}'
      where "result" is not null;
    `);
  }
}
