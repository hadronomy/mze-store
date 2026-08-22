import { model } from "@medusajs/framework/utils";
import { CATALOG_SYNC_STATES } from "~/modules/catalog-sync/types";

const SyncRecord = model
  .define("sync_record", {
    id: model.id({ prefix: "syncrec" }).primaryKey(),
    operation_id: model.text(),
    request_fingerprint: model.text(),
    response_fingerprint: model.text().nullable(),
    state: model.enum([...CATALOG_SYNC_STATES]),
    attempts: model.number().default(0),
    source_revision_changed_at: model.text().nullable(),
    source_revision_product_id: model.number().nullable(),
    next_cursor_changed_at: model.text().nullable(),
    next_cursor_product_id: model.number().nullable(),
    medusa_product_id: model.text().nullable(),
    result: model.json().nullable(),
    error_type: model.text().nullable(),
    error_code: model.text().nullable(),
    error_message: model.text().nullable(),
    started_at: model.dateTime().nullable(),
    finished_at: model.dateTime().nullable(),
  })
  .indexes([
    {
      name: "IDX_sync_record_operation_id_unique",
      on: ["operation_id"],
      unique: true,
      where: "deleted_at IS NULL",
    },
  ]);

export default SyncRecord;
