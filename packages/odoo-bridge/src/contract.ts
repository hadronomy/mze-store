import { Schema } from "effect";

export const ODOO_BRIDGE_MODEL = "mze.medusa.bridge" as const;
export const ODOO_BRIDGE_METHOD = "read_catalog_batch" as const;
export const ODOO_CATALOG_CONTRACT_VERSION = "mze.odoo.catalog.v1" as const;

const OdooDateTime = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u),
);
const Decimal = Schema.String.check(Schema.isPattern(/^\d+(?:\.\d{1,6})?$/u));
const IntegrationKey = Schema.String.check(Schema.isUUID());
const NonEmptyString = Schema.String.check(Schema.isMinLength(1));

export const OdooBridgeConfigSchema = Schema.Struct({
  apiKey: NonEmptyString,
  baseUrl: NonEmptyString,
  database: NonEmptyString,
});

export type OdooBridgeConfig = Schema.Schema.Type<typeof OdooBridgeConfigSchema>;

export const OdooCatalogCursorSchema = Schema.Struct({
  id: Schema.Int.check(Schema.isGreaterThan(0)),
  write_date: OdooDateTime,
});

export type OdooCatalogCursor = Schema.Schema.Type<typeof OdooCatalogCursorSchema>;

export const OdooCatalogBatchRequestSchema = Schema.Struct({
  cursor: Schema.NullOr(OdooCatalogCursorSchema),
  limit: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 })),
});

export type OdooCatalogBatchRequest = Schema.Schema.Type<typeof OdooCatalogBatchRequestSchema>;

export type OdooCatalogBatchRequestInput = {
  readonly cursor?: OdooCatalogCursor | null;
  readonly limit?: number;
};

const OdooAttributeValueSchema = Schema.Struct({
  attribute_id: Schema.Int.check(Schema.isGreaterThan(0)),
  attribute_name: NonEmptyString,
  id: Schema.Int.check(Schema.isGreaterThan(0)),
  name: NonEmptyString,
});

const OdooVariantSchema = Schema.Struct({
  active: Schema.Boolean,
  attribute_values: Schema.Array(OdooAttributeValueSchema),
  barcode: Schema.NullOr(NonEmptyString),
  default_code: Schema.NullOr(NonEmptyString),
  id: Schema.Int.check(Schema.isGreaterThan(0)),
  integration_key: IntegrationKey,
  model: Schema.Literal("product.product"),
  name: NonEmptyString,
  price: Decimal,
  sale_ok: Schema.Boolean,
  write_date: OdooDateTime,
});

export const OdooCatalogVariantSchema = OdooVariantSchema;
export type OdooCatalogVariant = Schema.Schema.Type<typeof OdooVariantSchema>;

const OdooTemplateSchema = Schema.Struct({
  active: Schema.Boolean,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/u)),
  description: Schema.NullOr(Schema.String),
  id: Schema.Int.check(Schema.isGreaterThan(0)),
  integration_key: IntegrationKey,
  model: Schema.Literal("product.template"),
  name: NonEmptyString,
  price: Decimal,
  sale_ok: Schema.Boolean,
  tax_ids: Schema.Array(Schema.Int.check(Schema.isGreaterThan(0))),
  write_date: OdooDateTime,
});

export const OdooCatalogTemplateSchema = OdooTemplateSchema;
export type OdooCatalogTemplate = Schema.Schema.Type<typeof OdooTemplateSchema>;

export const OdooCatalogItemSchema = Schema.Struct({
  template: OdooTemplateSchema,
  variants: Schema.Array(OdooVariantSchema).check(Schema.isMinLength(1)),
});

export type OdooCatalogItem = Schema.Schema.Type<typeof OdooCatalogItemSchema>;

export const OdooCatalogBatchSchema = Schema.Struct({
  contract_version: Schema.Literal(ODOO_CATALOG_CONTRACT_VERSION),
  items: Schema.Array(OdooCatalogItemSchema).check(Schema.isMaxLength(100)),
  next_cursor: Schema.NullOr(OdooCatalogCursorSchema),
});

export type OdooCatalogBatch = Schema.Schema.Type<typeof OdooCatalogBatchSchema>;

const OdooDocumentationModelSchema = Schema.Struct({
  model: NonEmptyString,
  methods: Schema.Array(NonEmptyString),
});

export const OdooDocumentationIndexSchema = Schema.Struct({
  models: Schema.Array(OdooDocumentationModelSchema),
  modules: Schema.Array(NonEmptyString),
});

export type OdooDocumentationIndex = Schema.Schema.Type<typeof OdooDocumentationIndexSchema>;

const OdooMethodDocumentationSchema = Schema.Struct({
  api: Schema.optionalKey(Schema.Array(NonEmptyString)),
});

export const OdooModelDocumentationSchema = Schema.Struct({
  methods: Schema.Record(Schema.String, OdooMethodDocumentationSchema),
  model: NonEmptyString,
});

export type OdooModelDocumentation = Schema.Schema.Type<typeof OdooModelDocumentationSchema>;
