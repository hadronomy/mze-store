import { z } from "@medusajs/framework/zod";
import { TAX_RATE_AUDIT_ACTIONS, TAX_RATE_AUDIT_ACTOR_KINDS } from "./types";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

type DateRange = {
  from?: Date;
  to?: Date;
};

function dateRangeIsOrdered(range: DateRange): boolean {
  return !range.from || !range.to || range.from <= range.to;
}

function toDate(value: string): Date {
  return new Date(value);
}

const DateTimeQuerySchema = z.iso.datetime({ offset: true }).transform(toDate);

export const TaxRateChangeListQuerySchema = z
  .object({
    tax_rate_id: z.string().trim().min(1).optional(),
    tax_region_id: z.string().trim().min(1).optional(),
    province_code: z.string().trim().min(1).optional(),
    actor_id: z.string().trim().min(1).optional(),
    action: z.enum(TAX_RATE_AUDIT_ACTIONS).optional(),
    from: DateTimeQuerySchema.optional(),
    to: DateTimeQuerySchema.optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(DEFAULT_LIMIT),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .refine(dateRangeIsOrdered, {
    message: "from must be before to",
    path: ["to"],
  });

export type TaxRateChangeListQuery = z.infer<typeof TaxRateChangeListQuerySchema>;

export const TaxRateChangeResponseSchema = z.object({
  id: z.string(),
  action: z.enum(TAX_RATE_AUDIT_ACTIONS),
  tax_rate_id: z.string(),
  tax_region_id: z.string(),
  country_code: z.string(),
  province_code: z.string().nullable(),
  tax_rate_name: z.string(),
  tax_rate_code: z.string().nullable(),
  before_rate: z.number().nullable(),
  after_rate: z.number().nullable(),
  actor_kind: z.enum(TAX_RATE_AUDIT_ACTOR_KINDS),
  actor_id: z.string(),
  actor_email: z.string().nullable(),
  occurred_at: z.iso.datetime({ offset: true }),
});

export const TaxRateChangesResponseSchema = z.object({
  tax_rate_changes: z.array(TaxRateChangeResponseSchema),
  count: z.number().int().min(0),
  limit: z.number().int().min(1).max(MAX_LIMIT),
  offset: z.number().int().min(0),
});

export type TaxRateChangeResponse = z.infer<typeof TaxRateChangeResponseSchema>;
export type TaxRateChangesResponse = z.infer<typeof TaxRateChangesResponseSchema>;
