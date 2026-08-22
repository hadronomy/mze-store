import { z } from "@medusajs/framework/zod";

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
  productId: z.number().int().positive(),
});

export const CatalogSynchronizationResultSchema = z.object({
  syncRecordId: z.string(),
  productId: z.string(),
  templateCatalogMappingId: z.string(),
  templateIntegrationKey: z.uuid(),
  variants: z.array(
    z.object({
      integrationKey: z.uuid(),
      odooVariantId: z.number().int().positive(),
      medusaVariantId: z.string(),
      catalogMappingId: z.string(),
      disposition: z.enum(["created", "updated", "unchanged", "archived", "reactivated"]),
      availability: z.enum(["available", "unavailable"]),
    }),
  ),
  sourceRevision: CatalogCursorSchema,
  nextCursor: CatalogCursorSchema.nullable(),
});

export type CatalogSynchronizationResult = z.infer<typeof CatalogSynchronizationResultSchema>;
