import { Schema } from "effect";

export const ODOO_BRIDGE_MODEL = "mze.medusa.bridge" as const;
export const ODOO_BRIDGE_METHOD = "read_catalog_batch" as const;
export const ODOO_BRIDGE_MODULE = "mze_medusa_bridge" as const;
export const ODOO_CATALOG_CONTRACT_VERSION = "mze.odoo.catalog.v1" as const;

const OdooDateTime = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u),
);
const Decimal = Schema.String.check(Schema.isPattern(/^\d+(?:\.\d{1,6})?$/u));
const IntegrationKey = Schema.String.check(Schema.isUUID());
const NonEmptyString = Schema.String.check(Schema.isMinLength(1));
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));

export const SourceRevisionSchema = Schema.Struct({
  changedAt: OdooDateTime,
  productId: PositiveInt,
}).pipe(
  Schema.encodeKeys({
    changedAt: "write_date",
    productId: "id",
  }),
);

export type SourceRevision = Schema.Schema.Type<typeof SourceRevisionSchema>;

const CatalogBatchLimit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }));

export const CatalogBatchInputSchema = Schema.Struct({
  cursor: Schema.optionalKey(Schema.NullOr(SourceRevisionSchema)),
  limit: Schema.optionalKey(CatalogBatchLimit),
});

export type CatalogBatchInput = Schema.Schema.Type<typeof CatalogBatchInputSchema>;

export const CatalogBatchRequestSchema = Schema.Struct({
  cursor: Schema.NullOr(SourceRevisionSchema),
  limit: CatalogBatchLimit,
});

export type CatalogBatchRequest = Schema.Schema.Type<typeof CatalogBatchRequestSchema>;

export const CatalogAttributeValueSchema = Schema.Struct({
  attributeId: PositiveInt,
  attributeName: NonEmptyString,
  id: PositiveInt,
  name: NonEmptyString,
}).pipe(
  Schema.encodeKeys({
    attributeId: "attribute_id",
    attributeName: "attribute_name",
  }),
);

export type CatalogAttributeValue = Schema.Schema.Type<typeof CatalogAttributeValueSchema>;

export const CatalogVariantSchema = Schema.Struct({
  active: Schema.Boolean,
  attributeValues: Schema.Array(CatalogAttributeValueSchema),
  barcode: Schema.NullOr(NonEmptyString),
  id: PositiveInt,
  integrationKey: IntegrationKey,
  internalReference: Schema.NullOr(NonEmptyString),
  model: Schema.Literal("product.product"),
  name: NonEmptyString,
  price: Decimal,
  saleOk: Schema.Boolean,
  writeDate: OdooDateTime,
}).pipe(
  Schema.encodeKeys({
    attributeValues: "attribute_values",
    integrationKey: "integration_key",
    internalReference: "default_code",
    saleOk: "sale_ok",
    writeDate: "write_date",
  }),
);

export type CatalogVariant = Schema.Schema.Type<typeof CatalogVariantSchema>;

export const CatalogTemplateSchema = Schema.Struct({
  active: Schema.Boolean,
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/u)),
  description: Schema.NullOr(Schema.String),
  id: PositiveInt,
  integrationKey: IntegrationKey,
  model: Schema.Literal("product.template"),
  name: NonEmptyString,
  price: Decimal,
  saleOk: Schema.Boolean,
  taxIds: Schema.Array(PositiveInt),
  writeDate: OdooDateTime,
}).pipe(
  Schema.encodeKeys({
    integrationKey: "integration_key",
    saleOk: "sale_ok",
    taxIds: "tax_ids",
    writeDate: "write_date",
  }),
);

export type CatalogTemplate = Schema.Schema.Type<typeof CatalogTemplateSchema>;

export const CatalogItemSchema = Schema.Struct({
  template: CatalogTemplateSchema,
  variants: Schema.Array(CatalogVariantSchema).check(Schema.isMinLength(1)),
});

export type CatalogItem = Schema.Schema.Type<typeof CatalogItemSchema>;

export const CatalogBatchSchema = Schema.Struct({
  contractVersion: Schema.Literal(ODOO_CATALOG_CONTRACT_VERSION),
  items: Schema.Array(CatalogItemSchema).check(Schema.isMaxLength(100)),
  nextCursor: Schema.NullOr(SourceRevisionSchema),
}).pipe(
  Schema.encodeKeys({
    contractVersion: "contract_version",
    nextCursor: "next_cursor",
  }),
);

export type CatalogBatch = Schema.Schema.Type<typeof CatalogBatchSchema>;

export const BridgeContractCheckSchema = Schema.Struct({
  contractVersion: Schema.Literal(ODOO_CATALOG_CONTRACT_VERSION),
  fixture: CatalogBatchSchema,
  method: Schema.Literal(ODOO_BRIDGE_METHOD),
  model: Schema.Literal(ODOO_BRIDGE_MODEL),
});

export type BridgeContractCheck = Schema.Schema.Type<typeof BridgeContractCheckSchema>;
