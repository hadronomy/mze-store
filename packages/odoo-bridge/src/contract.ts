import { Schema } from "effect";

export const ODOO_BRIDGE_MODEL = "mze.medusa.bridge" as const;
export const ODOO_BRIDGE_METHOD = "read_catalog_batch" as const;
export const ODOO_BRIDGE_MODULE = "mze_medusa_bridge" as const;
export const ODOO_CATALOG_CONTRACT_VERSION = "mze.odoo.catalog.v1" as const;

const OdooDateTime = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u),
).pipe(Schema.brand("@mze-store/odoo-bridge/OdooDateTime"));
const Decimal = Schema.String.check(Schema.isPattern(/^-?\d+(?:\.\d{1,6})?$/u)).pipe(
  Schema.brand("@mze-store/odoo-bridge/Decimal"),
);
const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0));

export const OdooIntegrationKeySchema = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand("@mze-store/odoo-bridge/OdooIntegrationKey"),
);
export type OdooIntegrationKey = Schema.Schema.Type<typeof OdooIntegrationKeySchema>;

export const OdooProductIdSchema = PositiveInt.pipe(
  Schema.brand("@mze-store/odoo-bridge/OdooProductId"),
);
export type OdooProductId = Schema.Schema.Type<typeof OdooProductIdSchema>;

export const OdooVariantIdSchema = PositiveInt.pipe(
  Schema.brand("@mze-store/odoo-bridge/OdooVariantId"),
);
export type OdooVariantId = Schema.Schema.Type<typeof OdooVariantIdSchema>;

export const OdooAttributeIdSchema = PositiveInt.pipe(
  Schema.brand("@mze-store/odoo-bridge/OdooAttributeId"),
);
export type OdooAttributeId = Schema.Schema.Type<typeof OdooAttributeIdSchema>;

export const OdooAttributeValueIdSchema = PositiveInt.pipe(
  Schema.brand("@mze-store/odoo-bridge/OdooAttributeValueId"),
);
export type OdooAttributeValueId = Schema.Schema.Type<typeof OdooAttributeValueIdSchema>;

export const OdooTemplateAttributeValueIdSchema = PositiveInt.pipe(
  Schema.brand("@mze-store/odoo-bridge/OdooTemplateAttributeValueId"),
);
export type OdooTemplateAttributeValueId = Schema.Schema.Type<
  typeof OdooTemplateAttributeValueIdSchema
>;

export const OdooPriceListIdSchema = PositiveInt.pipe(
  Schema.brand("@mze-store/odoo-bridge/OdooPriceListId"),
);
export type OdooPriceListId = Schema.Schema.Type<typeof OdooPriceListIdSchema>;

export const OdooPriceRuleIdSchema = PositiveInt.pipe(
  Schema.brand("@mze-store/odoo-bridge/OdooPriceRuleId"),
);
export type OdooPriceRuleId = Schema.Schema.Type<typeof OdooPriceRuleIdSchema>;

export const OdooTaxIdSchema = PositiveInt.pipe(Schema.brand("@mze-store/odoo-bridge/OdooTaxId"));
export type OdooTaxId = Schema.Schema.Type<typeof OdooTaxIdSchema>;

export const SourceRevisionSchema = Schema.Struct({
  changedAt: OdooDateTime,
  productId: OdooProductIdSchema,
}).pipe(
  Schema.encodeKeys({
    changedAt: "write_date",
    productId: "id",
  }),
);

export type SourceRevision = Schema.Schema.Type<typeof SourceRevisionSchema>;

const CatalogBatchLimit = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }));

export const CatalogBatchInputSchema = Schema.Struct({
  cursor: Schema.optionalKey(Schema.NullOr(Schema.toType(SourceRevisionSchema))),
  limit: Schema.optionalKey(CatalogBatchLimit),
});

export type CatalogBatchInput = Schema.Schema.Type<typeof CatalogBatchInputSchema>;

export const CatalogBatchRequestSchema = Schema.Struct({
  cursor: Schema.NullOr(SourceRevisionSchema),
  limit: CatalogBatchLimit,
});

export type CatalogBatchRequest = Schema.Schema.Type<typeof CatalogBatchRequestSchema>;
export type CatalogBatchRequestEncoded = Schema.Codec.Encoded<typeof CatalogBatchRequestSchema>;

export const CatalogAttributeValueSchema = Schema.Struct({
  id: OdooAttributeValueIdSchema,
  name: Schema.NonEmptyString,
  templateValueId: OdooTemplateAttributeValueIdSchema,
}).pipe(Schema.encodeKeys({ templateValueId: "template_value_id" }));

export type CatalogAttributeValue = Schema.Schema.Type<typeof CatalogAttributeValueSchema>;

export const CatalogAttributeSchema = Schema.Struct({
  id: OdooAttributeIdSchema,
  name: Schema.NonEmptyString,
  values: Schema.NonEmptyArray(CatalogAttributeValueSchema),
  variantCreationMode: Schema.Literals(["always", "dynamic", "never"]),
}).pipe(Schema.encodeKeys({ variantCreationMode: "variant_creation_mode" }));

export type CatalogAttribute = Schema.Schema.Type<typeof CatalogAttributeSchema>;

export const CatalogVariantAttributeValueSchema = Schema.Struct({
  attributeId: OdooAttributeIdSchema,
  valueId: OdooAttributeValueIdSchema,
}).pipe(
  Schema.encodeKeys({
    attributeId: "attribute_id",
    valueId: "value_id",
  }),
);

export type CatalogVariantAttributeValue = Schema.Schema.Type<
  typeof CatalogVariantAttributeValueSchema
>;

const CatalogTemplateMediaReferenceSchema = Schema.Struct({
  field: Schema.Literal("image_1920"),
  model: Schema.Literal("product.template"),
  recordId: OdooProductIdSchema,
  writeDate: OdooDateTime,
}).pipe(
  Schema.encodeKeys({
    recordId: "record_id",
    writeDate: "write_date",
  }),
);

const CatalogVariantMediaReferenceSchema = Schema.Struct({
  field: Schema.Literal("image_variant_1920"),
  model: Schema.Literal("product.product"),
  recordId: OdooVariantIdSchema,
  writeDate: OdooDateTime,
}).pipe(
  Schema.encodeKeys({
    recordId: "record_id",
    writeDate: "write_date",
  }),
);

export const CatalogMediaReferenceSchema = Schema.Union([
  CatalogTemplateMediaReferenceSchema,
  CatalogVariantMediaReferenceSchema,
]);

export type CatalogMediaReference = Schema.Schema.Type<typeof CatalogMediaReferenceSchema>;

export const CatalogTaxSchema = Schema.Struct({
  amount: Decimal,
  amountType: Schema.Literals(["division", "fixed", "group", "percent"]),
  id: OdooTaxIdSchema,
  isBaseAffected: Schema.Boolean,
  includeBaseAmount: Schema.Boolean,
  name: Schema.NonEmptyString,
  parentTaxId: Schema.NullOr(OdooTaxIdSchema),
  priceIncluded: Schema.Boolean,
  sequence: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).pipe(
  Schema.encodeKeys({
    amountType: "amount_type",
    isBaseAffected: "is_base_affected",
    includeBaseAmount: "include_base_amount",
    parentTaxId: "parent_tax_id",
    priceIncluded: "price_included",
  }),
);

export type CatalogTax = Schema.Schema.Type<typeof CatalogTaxSchema>;

export const CatalogPriceListSchema = Schema.Struct({
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/u)),
  id: OdooPriceListIdSchema,
  name: Schema.NonEmptyString,
});

export type CatalogPriceList = Schema.Schema.Type<typeof CatalogPriceListSchema>;

export const CatalogVariantSchema = Schema.Struct({
  active: Schema.Boolean,
  attributeValues: Schema.Array(CatalogVariantAttributeValueSchema),
  barcode: Schema.NullOr(Schema.NonEmptyString),
  id: OdooVariantIdSchema,
  integrationKey: OdooIntegrationKeySchema,
  internalReference: Schema.NullOr(Schema.NonEmptyString),
  media: Schema.Array(CatalogVariantMediaReferenceSchema),
  model: Schema.Literal("product.product"),
  name: Schema.NonEmptyString,
  price: Decimal,
  priceRuleId: Schema.NullOr(OdooPriceRuleIdSchema),
  saleOk: Schema.Boolean,
  writeDate: OdooDateTime,
}).pipe(
  Schema.encodeKeys({
    attributeValues: "attribute_values",
    integrationKey: "integration_key",
    internalReference: "default_code",
    priceRuleId: "price_rule_id",
    saleOk: "sale_ok",
    writeDate: "write_date",
  }),
);

export type CatalogVariant = Schema.Schema.Type<typeof CatalogVariantSchema>;

export const CatalogTemplateSchema = Schema.Struct({
  active: Schema.Boolean,
  attributes: Schema.Array(CatalogAttributeSchema),
  description: Schema.NullOr(Schema.String),
  id: OdooProductIdSchema,
  integrationKey: OdooIntegrationKeySchema,
  media: Schema.Array(CatalogTemplateMediaReferenceSchema),
  model: Schema.Literal("product.template"),
  name: Schema.NonEmptyString,
  saleOk: Schema.Boolean,
  taxes: Schema.Array(CatalogTaxSchema),
  writeDate: OdooDateTime,
}).pipe(
  Schema.encodeKeys({
    integrationKey: "integration_key",
    saleOk: "sale_ok",
    writeDate: "write_date",
  }),
);

export type CatalogTemplate = Schema.Schema.Type<typeof CatalogTemplateSchema>;

export const CatalogRecordReferenceSchema = Schema.Union([
  Schema.Struct({ id: OdooProductIdSchema, model: Schema.Literal("product.template") }),
  Schema.Struct({ id: OdooVariantIdSchema, model: Schema.Literal("product.product") }),
]);

export type CatalogRecordReference = Schema.Schema.Type<typeof CatalogRecordReferenceSchema>;

export const CatalogItemSchema = Schema.Struct({
  sourceRevision: SourceRevisionSchema,
  template: CatalogTemplateSchema,
  variants: Schema.NonEmptyArray(CatalogVariantSchema),
}).pipe(Schema.encodeKeys({ sourceRevision: "source_revision" }));

export type CatalogItem = Schema.Schema.Type<typeof CatalogItemSchema>;

export const CatalogBatchSchema = Schema.Struct({
  contractVersion: Schema.Literal(ODOO_CATALOG_CONTRACT_VERSION),
  items: Schema.Array(CatalogItemSchema).check(Schema.isMaxLength(100)),
  nextCursor: Schema.NullOr(SourceRevisionSchema),
  priceList: CatalogPriceListSchema,
  pricedAt: OdooDateTime,
}).pipe(
  Schema.encodeKeys({
    contractVersion: "contract_version",
    nextCursor: "next_cursor",
    priceList: "price_list",
    pricedAt: "priced_at",
  }),
);

export type CatalogBatch = Schema.Schema.Type<typeof CatalogBatchSchema>;
export type CatalogBatchEncoded = Schema.Codec.Encoded<typeof CatalogBatchSchema>;

export const BridgeContractCheckSchema = Schema.Struct({
  contractVersion: Schema.Literal(ODOO_CATALOG_CONTRACT_VERSION),
  fixture: CatalogBatchSchema,
  method: Schema.Literal(ODOO_BRIDGE_METHOD),
  model: Schema.Literal(ODOO_BRIDGE_MODEL),
});

export type BridgeContractCheck = Schema.Schema.Type<typeof BridgeContractCheckSchema>;
export type BridgeContractCheckEncoded = Schema.Codec.Encoded<typeof BridgeContractCheckSchema>;
