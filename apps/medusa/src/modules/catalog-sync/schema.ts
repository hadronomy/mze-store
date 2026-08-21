import { z } from "@medusajs/framework/zod";

const SourceRevisionRequestSchema = z
  .object({
    id: z.number().int().positive(),
    write_date: z.string().datetime({ offset: true }),
  })
  .transform((revision) => ({
    changedAt: revision.write_date,
    productId: revision.id,
  }));

export const CatalogImportRequestSchema = z.object({
  cursor: SourceRevisionRequestSchema.nullable().optional(),
});

export type CatalogImportRequest = z.infer<typeof CatalogImportRequestSchema>;
