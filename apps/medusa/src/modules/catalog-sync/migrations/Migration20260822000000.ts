import { Migration } from "@medusajs/framework/mikro-orm/migrations";

export class Migration20260822000000 extends Migration {
  async up(): Promise<void> {
    this.addSql('alter table "sync_record" drop column if exists "next_attempt_at";');
    this.addSql('drop index if exists "IDX_sync_record_state_next_attempt_at";');

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

    // Normalize states that no longer exist before tightening the checks.
    this.addSql(
      `update "sync_record" set "state" = 'failed' where "state" in ('pending', 'dead_letter');`,
    );
    this.addSql(`update "sync_record" set "state" = 'succeeded' where "state" = 'archived';`);
    this.addSql(
      `update "catalog_mapping" set "sync_state" = 'failed' where "sync_state" in ('pending', 'dead_letter');`,
    );
    this.addSql(
      `update "catalog_mapping" set "sync_state" = 'succeeded' where "sync_state" = 'archived';`,
    );

    this.addSql('alter table "sync_record" drop constraint if exists "sync_record_state_check";');
    this.addSql(
      `alter table "sync_record" add constraint "sync_record_state_check" check ("state" in ('in_progress', 'succeeded', 'failed'));`,
    );
    this.addSql(
      'alter table "catalog_mapping" drop constraint if exists "catalog_mapping_sync_state_check";',
    );
    this.addSql(
      `alter table "catalog_mapping" add constraint "catalog_mapping_sync_state_check" check ("sync_state" in ('in_progress', 'succeeded', 'failed'));`,
    );
  }

  async down(): Promise<void> {
    this.addSql(
      'alter table "sync_record" add column "source_template_integration_key" text null;',
    );
    this.addSql(`
      update "sync_record"
      set "source_template_integration_key" = "result" #>> '{templateIntegrationKey}'
      where "result" is not null;
    `);
    this.addSql('alter table "sync_record" add column "next_attempt_at" timestamptz null;');
    this.addSql(
      'CREATE INDEX IF NOT EXISTS "IDX_sync_record_state_next_attempt_at" ON "sync_record" ("state", "next_attempt_at") WHERE deleted_at IS NULL;',
    );

    this.addSql('alter table "sync_record" drop constraint if exists "sync_record_state_check";');
    this.addSql(
      `alter table "sync_record" add constraint "sync_record_state_check" check ("state" in ('pending', 'in_progress', 'succeeded', 'failed', 'dead_letter', 'archived'));`,
    );
    this.addSql(
      'alter table "catalog_mapping" drop constraint if exists "catalog_mapping_sync_state_check";',
    );
    this.addSql(
      `alter table "catalog_mapping" add constraint "catalog_mapping_sync_state_check" check ("sync_state" in ('pending', 'in_progress', 'succeeded', 'failed', 'dead_letter', 'archived'));`,
    );
  }
}
