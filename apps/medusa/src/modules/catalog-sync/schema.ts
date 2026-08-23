import { z } from "@medusajs/framework/zod";
import {
  decodeOdooIntegrationKey,
  decodeOdooProductId,
  decodeOdooVariantId,
} from "@mze-store/odoo-bridge";

const SourceRevisionRequestSchema = z
  .object({
    id: z.number().int().positive(),
    write_date: z.iso.datetime({ offset: true }),
  })
  .transform((revision) => ({
    changedAt: revision.write_date,
    productId: revision.id,
  }));

export const CatalogImportRequestSchema = z.object({
  cursor: SourceRevisionRequestSchema.nullable().optional(),
});

export type CatalogImportRequest = z.infer<typeof CatalogImportRequestSchema>;

const CatalogCursorSchema = z.object({
  changedAt: z.iso.datetime({ offset: true }),
  productId: z.number().int().positive().transform(decodeOdooProductId),
});

export const CatalogSynchronizationResultSchema = z.object({
  syncRecordId: z.string(),
  productId: z.string(),
  templateCatalogMappingId: z.string(),
  templateIntegrationKey: z.uuid().transform(decodeOdooIntegrationKey),
  variants: z.array(
    z.object({
      integrationKey: z.uuid().transform(decodeOdooIntegrationKey),
      odooVariantId: z.number().int().positive().transform(decodeOdooVariantId),
      medusaVariantId: z.string(),
      catalogMappingId: z.string(),
      disposition: z.enum(["created", "updated", "unchanged", "archived", "reactivated"]),
      sourceAvailable: z.boolean(),
      approvalState: z.enum(["pending", "approved"]),
    }),
  ),
  sourceRevision: CatalogCursorSchema,
  nextCursor: CatalogCursorSchema.nullable(),
});

export type CatalogSynchronizationResult = z.infer<typeof CatalogSynchronizationResultSchema>;
