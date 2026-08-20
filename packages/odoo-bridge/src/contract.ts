import { z } from "zod";

export const ODOO_BRIDGE_MODEL = "mze.medusa.bridge" as const;
export const ODOO_BRIDGE_METHOD = "read_catalog_batch" as const;
export const ODOO_CATALOG_CONTRACT_VERSION = "mze.odoo.catalog.v1" as const;

const OdooDateTimeSchema = z.string().datetime({ offset: true });
const DecimalSchema = z.string().regex(/^\d+(?:\.\d{1,6})?$/u);
const IntegrationKeySchema = z.string().uuid();

export const OdooBridgeConfigSchema = z.object({
  baseUrl: z.string().url(),
  database: z.string().trim().min(1),
  apiKey: z.string().min(1),
});

export type OdooBridgeConfig = z.infer<typeof OdooBridgeConfigSchema>;

export const OdooCatalogCursorSchema = z.object({
  id: z.number().int().positive(),
  write_date: OdooDateTimeSchema,
});

export type OdooCatalogCursor = z.infer<typeof OdooCatalogCursorSchema>;

export const OdooCatalogBatchRequestSchema = z.object({
  limit: z.number().int().min(1).max(100).default(25),
  cursor: OdooCatalogCursorSchema.nullable().default(null),
});

export type OdooCatalogBatchRequest = z.input<typeof OdooCatalogBatchRequestSchema>;

const OdooAttributeValueSchema = z.object({
  attribute_id: z.number().int().positive(),
  attribute_name: z.string().min(1),
  id: z.number().int().positive(),
  name: z.string().min(1),
});

const OdooVariantSchema = z.object({
  active: z.boolean(),
  attribute_values: z.array(OdooAttributeValueSchema),
  barcode: z.string().min(1).nullable(),
  default_code: z.string().min(1).nullable(),
  id: z.number().int().positive(),
  integration_key: IntegrationKeySchema,
  model: z.literal("product.product"),
  name: z.string().min(1),
  price: DecimalSchema,
  sale_ok: z.boolean(),
  write_date: OdooDateTimeSchema,
});

export type OdooCatalogVariant = z.infer<typeof OdooVariantSchema>;

const OdooTemplateSchema = z.object({
  active: z.boolean(),
  currency: z.string().regex(/^[A-Z]{3}$/u),
  description: z.string().nullable(),
  id: z.number().int().positive(),
  integration_key: IntegrationKeySchema,
  model: z.literal("product.template"),
  name: z.string().min(1),
  price: DecimalSchema,
  sale_ok: z.boolean(),
  tax_ids: z.array(z.number().int().positive()),
  write_date: OdooDateTimeSchema,
});

export type OdooCatalogTemplate = z.infer<typeof OdooTemplateSchema>;

export const OdooCatalogItemSchema = z.object({
  template: OdooTemplateSchema,
  variants: z.array(OdooVariantSchema).min(1),
});

export type OdooCatalogItem = z.infer<typeof OdooCatalogItemSchema>;

export const OdooCatalogBatchSchema = z.object({
  contract_version: z.literal(ODOO_CATALOG_CONTRACT_VERSION),
  items: z.array(OdooCatalogItemSchema).max(100),
  next_cursor: OdooCatalogCursorSchema.nullable(),
});

export type OdooCatalogBatch = z.infer<typeof OdooCatalogBatchSchema>;

const OdooDocumentationModelSchema = z.object({
  model: z.string().min(1),
  methods: z.array(z.string().min(1)),
});

export const OdooDocumentationIndexSchema = z.object({
  models: z.array(OdooDocumentationModelSchema),
  modules: z.array(z.string().min(1)),
});

export type OdooDocumentationIndex = z.infer<typeof OdooDocumentationIndexSchema>;

const OdooMethodDocumentationSchema = z.looseObject({
  api: z.array(z.string().min(1)).optional(),
});

export const OdooModelDocumentationSchema = z.object({
  methods: z.record(z.string(), OdooMethodDocumentationSchema),
  model: z.string().min(1),
});

export type OdooModelDocumentation = z.infer<typeof OdooModelDocumentationSchema>;
