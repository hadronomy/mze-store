import type { IProductModuleService } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import type { CatalogBatchEncoded } from "@mze-store/odoo-bridge/contract";
import { CATALOG_SYNC_MODULE, type CatalogSyncModuleService } from "~/modules/catalog-sync";
import { seedTerritoryProbe, type SeededProbe } from "~/territory/probe";
import { seedTerritory, type SeededTerritory } from "~/territory/seed";
import { SPAIN_DECLARATION } from "~/territory/spain";
import { signInAsOperator } from "../utils/operator";

jest.setTimeout(120 * 1000);

const ODOO_CATALOG_PATH = "/json/2/mze.medusa.bridge/read_catalog_batch";
const ODOO_BASE_URL = requireContractValue("ODOO_BASE_URL");
const ODOO_DATABASE = requireContractValue("ODOO_DATABASE");
const ODOO_API_KEY = requireContractValue("ODOO_API_KEY");
const TEMPLATE_INTEGRATION_KEY = "3f8c5e48-4aa9-4a77-b4f4-1f9ff22e1182";
const VARIANT_INTEGRATION_KEY = "5aa969c0-8eb2-4a68-a093-8e0f9bd66f52";

function requireContractValue(name: "ODOO_API_KEY" | "ODOO_BASE_URL" | "ODOO_DATABASE"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`The Catalog intake test requires ${name}.`);
  }

  return value;
}

const CatalogImportResponseSchema = z.object({
  product: z.object({
    id: z.string(),
    title: z.string(),
    status: z.literal("draft"),
    options: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        is_exclusive: z.boolean(),
        metadata: z.record(z.string(), z.unknown()).nullable(),
        values: z.array(z.object({ value: z.string() })),
      }),
    ),
    variants: z.array(
      z.object({
        id: z.string(),
        title: z.string(),
        sku: z.string().nullable(),
        barcode: z.string().nullable(),
        prices: z.array(
          z.object({
            amount: z.number(),
            currency_code: z.string(),
          }),
        ),
      }),
    ),
  }),
  catalog_import: z.object({
    disposition: z.enum(["created", "updated", "unchanged", "replayed"]),
    operation_id: z.string(),
    sync_record_id: z.string(),
    catalog_mapping_ids: z.object({
      template: z.string(),
      variants: z.array(z.string()),
    }),
    variants: z.array(
      z.object({
        integration_key: z.uuid(),
        odoo_variant_id: z.number().int().positive(),
        medusa_variant_id: z.string(),
        catalog_mapping_id: z.string(),
        disposition: z.enum(["created", "updated", "unchanged", "archived", "reactivated"]),
        availability: z.enum(["available", "unavailable"]),
      }),
    ),
    source_revision: z.object({
      id: z.number().int().positive(),
      write_date: z.iso.datetime({ offset: true }),
    }),
    next_cursor: z
      .object({
        id: z.number().int().positive(),
        write_date: z.iso.datetime({ offset: true }),
      })
      .nullable(),
  }),
});

const validCatalogBatch = {
  contract_version: "mze.odoo.catalog.v1",
  items: [
    {
      source_revision: { id: 352, write_date: "2026-08-09T12:00:00Z" },
      template: {
        active: true,
        attributes: [],
        description: "Gentle daily cleanser",
        id: 352,
        integration_key: TEMPLATE_INTEGRATION_KEY,
        media: [],
        model: "product.template",
        name: "A-TOPIC GEL",
        sale_ok: true,
        taxes: [],
        write_date: "2026-08-08T11:40:28Z",
      },
      variants: [
        {
          active: true,
          attribute_values: [],
          barcode: "8412345678901",
          default_code: "ATOPIC-001",
          id: 823,
          integration_key: VARIANT_INTEGRATION_KEY,
          media: [],
          model: "product.product",
          name: "A-TOPIC GEL",
          price: "20.75",
          price_rule_id: null,
          sale_ok: true,
          write_date: "2026-08-08T11:40:28Z",
        },
      ],
    },
  ],
  next_cursor: { id: 352, write_date: "2026-08-09T12:00:00Z" },
  price_list: { currency: "EUR", id: 1, name: "Public Pricelist" },
  priced_at: "2026-08-10T09:30:00Z",
} as const satisfies CatalogBatchEncoded;

const singleAttributeCatalogBatch = {
  ...validCatalogBatch,
  items: [
    {
      ...validCatalogBatch.items[0],
      source_revision: { id: 401, write_date: "2026-08-11T12:00:00Z" },
      template: {
        ...validCatalogBatch.items[0].template,
        attributes: [
          {
            id: 41,
            name: "Size",
            values: [
              { id: 51, name: "250 ml", template_value_id: 61 },
              { id: 52, name: "500 ml", template_value_id: 62 },
            ],
            variant_creation_mode: "always",
          },
        ],
        id: 401,
        integration_key: "00000000-0000-4000-8000-000000000401",
        name: "BODY WASH",
      },
      variants: [
        {
          ...validCatalogBatch.items[0].variants[0],
          attribute_values: [{ attribute_id: 41, value_id: 51 }],
          barcode: "8412345679001",
          default_code: "BODY-WASH-250",
          id: 901,
          integration_key: "00000000-0000-4000-8000-000000000901",
          name: "BODY WASH 250 ml",
        },
        {
          ...validCatalogBatch.items[0].variants[0],
          attribute_values: [{ attribute_id: 41, value_id: 52 }],
          barcode: "8412345679002",
          default_code: "BODY-WASH-500",
          id: 902,
          integration_key: "00000000-0000-4000-8000-000000000902",
          name: "BODY WASH 500 ml",
          price: "31.50",
        },
      ],
    },
  ],
  next_cursor: { id: 401, write_date: "2026-08-11T12:00:00Z" },
} as const satisfies CatalogBatchEncoded;

const multiAttributeCatalogBatch = {
  ...singleAttributeCatalogBatch,
  items: [
    {
      ...singleAttributeCatalogBatch.items[0],
      source_revision: { id: 402, write_date: "2026-08-12T12:00:00Z" },
      template: {
        ...singleAttributeCatalogBatch.items[0].template,
        attributes: [
          ...singleAttributeCatalogBatch.items[0].template.attributes,
          {
            id: 42,
            name: "Scent",
            values: [
              { id: 53, name: "Unscented", template_value_id: 63 },
              { id: 54, name: "Citrus", template_value_id: 64 },
            ],
            variant_creation_mode: "always",
          },
        ],
        id: 402,
        integration_key: "00000000-0000-4000-8000-000000000402",
        name: "HAND SOAP",
      },
      variants: [51, 52].flatMap((sizeId, sizeIndex) =>
        [53, 54].map((scentId, scentIndex) => {
          const number = 910 + sizeIndex * 2 + scentIndex;
          return {
            ...singleAttributeCatalogBatch.items[0].variants[sizeIndex]!,
            attribute_values: [
              { attribute_id: 41, value_id: sizeId },
              { attribute_id: 42, value_id: scentId },
            ],
            barcode: `8412345679${number}`,
            default_code: `HAND-SOAP-${number}`,
            id: number,
            integration_key: `00000000-0000-4000-8000-000000000${number}`,
            name: `HAND SOAP ${number}`,
          };
        }),
      ),
    },
  ],
  next_cursor: { id: 402, write_date: "2026-08-12T12:00:00Z" },
} as const satisfies CatalogBatchEncoded;

const dynamicAndNeverCatalogBatch = {
  ...validCatalogBatch,
  items: [
    {
      ...validCatalogBatch.items[0],
      source_revision: { id: 403, write_date: "2026-08-13T12:00:00Z" },
      template: {
        ...validCatalogBatch.items[0].template,
        attributes: [
          {
            id: 43,
            name: "Finish",
            values: [
              { id: 55, name: "Matte", template_value_id: 65 },
              { id: 56, name: "Gloss", template_value_id: 66 },
            ],
            variant_creation_mode: "dynamic",
          },
          {
            id: 44,
            name: "Gift message",
            values: [{ id: 57, name: "Included", template_value_id: 67 }],
            variant_creation_mode: "never",
          },
        ],
        id: 403,
        integration_key: "00000000-0000-4000-8000-000000000403",
        name: "CANDLE",
      },
      variants: [
        {
          ...validCatalogBatch.items[0].variants[0],
          attribute_values: [{ attribute_id: 43, value_id: 55 }],
          id: 920,
          integration_key: "00000000-0000-4000-8000-000000000920",
          name: "CANDLE MATTE",
        },
        {
          ...validCatalogBatch.items[0].variants[0],
          active: false,
          attribute_values: [{ attribute_id: 43, value_id: 56 }],
          barcode: "8412345678921",
          default_code: "CANDLE-GLOSS",
          id: 921,
          integration_key: "00000000-0000-4000-8000-000000000921",
          name: "CANDLE GLOSS",
        },
      ],
    },
  ],
  next_cursor: { id: 403, write_date: "2026-08-13T12:00:00Z" },
} as const satisfies CatalogBatchEncoded;

const changedIdentityCatalogBatch = {
  ...singleAttributeCatalogBatch,
  items: [
    {
      ...singleAttributeCatalogBatch.items[0],
      source_revision: { id: 401, write_date: "2026-08-14T12:00:00Z" },
      template: {
        ...singleAttributeCatalogBatch.items[0].template,
        attributes: [
          {
            ...singleAttributeCatalogBatch.items[0].template.attributes[0],
            name: "Volume",
            values: [
              { id: 51, name: "Small", template_value_id: 61 },
              { id: 52, name: "Large", template_value_id: 62 },
            ],
          },
        ],
        name: "BODY WASH SOURCE NAME",
      },
      variants: [
        {
          ...singleAttributeCatalogBatch.items[0].variants[0],
          barcode: "8412345679901",
          default_code: "BODY-WASH-250-NEW",
          name: "BODY WASH SOURCE 250",
        },
        {
          ...singleAttributeCatalogBatch.items[0].variants[1],
          active: false,
          barcode: "8412345679902",
          default_code: "BODY-WASH-500-NEW",
          name: "BODY WASH SOURCE 500",
        },
      ],
    },
  ],
  next_cursor: { id: 401, write_date: "2026-08-14T12:00:00Z" },
} as const satisfies CatalogBatchEncoded;

const reactivatedIdentityCatalogBatch = {
  ...changedIdentityCatalogBatch,
  items: [
    {
      ...changedIdentityCatalogBatch.items[0],
      source_revision: { id: 401, write_date: "2026-08-15T12:00:00Z" },
      variants: changedIdentityCatalogBatch.items[0].variants.map((variant) => ({
        ...variant,
        active: true,
      })),
    },
  ],
  next_cursor: { id: 401, write_date: "2026-08-15T12:00:00Z" },
} as const satisfies CatalogBatchEncoded;

const archivedTemplateCatalogBatch = {
  ...reactivatedIdentityCatalogBatch,
  items: [
    {
      ...reactivatedIdentityCatalogBatch.items[0],
      source_revision: { id: 401, write_date: "2026-08-15T13:00:00Z" },
      template: {
        ...reactivatedIdentityCatalogBatch.items[0].template,
        active: false,
      },
    },
  ],
  next_cursor: { id: 401, write_date: "2026-08-15T13:00:00Z" },
} as const satisfies CatalogBatchEncoded;

const reactivatedTemplateCatalogBatch = {
  ...reactivatedIdentityCatalogBatch,
  items: [
    {
      ...reactivatedIdentityCatalogBatch.items[0],
      source_revision: { id: 401, write_date: "2026-08-15T14:00:00Z" },
    },
  ],
  next_cursor: { id: 401, write_date: "2026-08-15T14:00:00Z" },
} as const satisfies CatalogBatchEncoded;

const dynamicInitialCatalogBatch = {
  ...dynamicAndNeverCatalogBatch,
  items: [
    {
      ...dynamicAndNeverCatalogBatch.items[0],
      variants: [dynamicAndNeverCatalogBatch.items[0].variants[0]],
    },
  ],
} as const satisfies CatalogBatchEncoded;

const dynamicNewVariantCatalogBatch = {
  ...dynamicAndNeverCatalogBatch,
  items: [
    {
      ...dynamicAndNeverCatalogBatch.items[0],
      source_revision: { id: 403, write_date: "2026-08-16T12:00:00Z" },
      template: {
        ...dynamicAndNeverCatalogBatch.items[0].template,
        attributes: dynamicAndNeverCatalogBatch.items[0].template.attributes.map((attribute) =>
          attribute.id === 43
            ? {
                ...attribute,
                values: [...attribute.values, { id: 58, name: "Satin", template_value_id: 68 }],
              }
            : attribute,
        ),
      },
      variants: [
        {
          ...dynamicAndNeverCatalogBatch.items[0].variants[0],
          barcode: "8412345678999",
          default_code: "CANDLE-MATTE-NEW",
        },
        {
          ...dynamicAndNeverCatalogBatch.items[0].variants[1],
          active: true,
          attribute_values: [{ attribute_id: 43, value_id: 58 }],
          barcode: "8412345678921",
          default_code: "CANDLE-SATIN",
          id: 922,
          integration_key: "00000000-0000-4000-8000-000000000922",
          name: dynamicAndNeverCatalogBatch.items[0].variants[0].name,
        },
      ],
    },
  ],
  next_cursor: { id: 403, write_date: "2026-08-16T12:00:00Z" },
} as const satisfies CatalogBatchEncoded;

type JsonInput =
  | boolean
  | null
  | number
  | string
  | readonly JsonInput[]
  | { readonly [key: string]: JsonInput | undefined };

function mockCatalogBatch(body: JsonInput = validCatalogBatch): OdooScope {
  const response = { body, consumed: false };
  odooResponses.push(response);
  return { isDone: () => response.consumed };
}

type OdooResponse = { body: JsonInput; consumed: boolean };
type OdooScope = { isDone(): boolean };

const nativeFetch = globalThis.fetch;
const odooCalls: Request[] = [];
const odooResponses: OdooResponse[] = [];
let beforeOdooRequest: (() => Promise<void>) | undefined;

const odooFetch: typeof globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  odooCalls.push(request);
  if (request.url !== `${ODOO_BASE_URL}${ODOO_CATALOG_PATH}` || request.method !== "POST") {
    throw new Error(`Unexpected Odoo request to ${request.method} ${request.url}.`);
  }
  if (
    request.headers.get("authorization") !== `Bearer ${ODOO_API_KEY}` ||
    request.headers.get("x-odoo-database") !== ODOO_DATABASE
  ) {
    throw new Error("The Odoo request did not use the Service User credentials.");
  }
  await beforeOdooRequest?.();
  const response = odooResponses.shift();
  if (!response) {
    throw new Error(`Unexpected Odoo request to ${request.url}.`);
  }

  response.consumed = true;
  return new Response(JSON.stringify(response.body), {
    headers: { "Content-Type": "application/json" },
    status: 200,
  });
};

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: function catalogIntakeTestSuite({ api, getContainer }) {
    let operator: Awaited<ReturnType<typeof signInAsOperator>>;
    let seeded: SeededTerritory;
    let probe: SeededProbe;

    beforeAll(async () => {
      globalThis.fetch = odooFetch;
      operator = await signInAsOperator(getContainer(), api, {
        email: "catalog-intake-operator@mze.store",
        password: "supersecret",
      });
      seeded = await seedTerritory(getContainer(), SPAIN_DECLARATION);
      probe = await seedTerritoryProbe(getContainer(), seeded);
    });

    beforeEach(() => {
      odooCalls.length = 0;
      odooResponses.length = 0;
      beforeOdooRequest = undefined;
    });

    afterEach(() => {
      expect(odooResponses).toHaveLength(0);
    });

    afterAll(() => {
      globalThis.fetch = nativeFetch;
    });

    it("imports one variant-less Odoo Product and replays the durable result", async () => {
      const catalogSync = getContainer().resolve<CatalogSyncModuleService>(CATALOG_SYNC_MODULE);
      let syncRecordIdBeforeRemote: string | undefined;
      let syncStateBeforeRemote: string | undefined;
      beforeOdooRequest = async () => {
        const [syncRecord] = await catalogSync.listSyncRecords({
          operation_id: "catalog-import--variant-less-product",
        });
        syncRecordIdBeforeRemote = syncRecord?.id;
        syncStateBeforeRemote = syncRecord?.state;
      };
      const odoo = mockCatalogBatch();
      const request = {
        headers: { ...operator.headers, "Idempotency-Key": "variant-less-product" },
      };

      const firstResponse = await api.post("/admin/odoo/catalog-imports", {}, request);
      const first = CatalogImportResponseSchema.parse(firstResponse.data);
      const replayResponse = await api.post("/admin/odoo/catalog-imports", {}, request);
      const replay = CatalogImportResponseSchema.parse(replayResponse.data);

      expect(firstResponse.status).toEqual(200);
      expect(first.product).toMatchObject({ title: "A-TOPIC GEL", status: "draft" });
      expect(first.product.options).toEqual([
        expect.objectContaining({
          title: "Configuration",
          is_exclusive: true,
          metadata: { mze_hidden: true, mze_source_generated: true },
          values: [{ value: "Default" }],
        }),
      ]);
      expect(first.product.variants).toEqual([
        expect.objectContaining({
          sku: "ATOPIC-001",
          prices: [expect.objectContaining({ amount: 20.75, currency_code: "eur" })],
        }),
      ]);
      expect(first.catalog_import).toMatchObject({
        disposition: "created",
        operation_id: "catalog-import--variant-less-product",
        source_revision: { id: 352, write_date: "2026-08-09T12:00:00Z" },
        next_cursor: { id: 352, write_date: "2026-08-09T12:00:00Z" },
      });
      expect(replay.catalog_import).toMatchObject({
        ...first.catalog_import,
        disposition: "replayed",
      });
      expect(replay.product.id).toEqual(first.product.id);
      expect(odoo.isDone()).toEqual(true);
      expect(odooCalls).toHaveLength(1);
      expect(syncRecordIdBeforeRemote).toEqual(first.catalog_import.sync_record_id);
      expect(syncStateBeforeRemote).toEqual("in_progress");
      await expect(odooCalls[0]!.json()).resolves.toEqual({ cursor: null, limit: 1 });

      const mappings = await catalogSync.listCatalogMappings(
        { medusa_product_id: first.product.id },
        { order: { odoo_model: "ASC" } },
      );
      const syncRecords = await catalogSync.listSyncRecords({
        operation_id: first.catalog_import.operation_id,
      });
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY);
      const { data: linkedProducts } = await query.graph({
        entity: "product",
        fields: ["id", "catalog_mapping.id"],
        filters: { id: first.product.id },
      });
      const { data: linkedVariants } = await query.graph({
        entity: "product_variant",
        fields: ["id", "catalog_mapping.id"],
        filters: { id: first.product.variants[0]!.id },
      });

      expect(mappings).toEqual([
        expect.objectContaining({
          odoo_database_id: 823,
          odoo_integration_key: VARIANT_INTEGRATION_KEY,
          odoo_model: "product.product",
          medusa_product_id: first.product.id,
          medusa_variant_id: first.product.variants[0]!.id,
          source_revision_changed_at: "2026-08-09T12:00:00Z",
          source_revision_product_id: 352,
          sync_state: "succeeded",
          archived: false,
        }),
        expect.objectContaining({
          odoo_database_id: 352,
          odoo_integration_key: TEMPLATE_INTEGRATION_KEY,
          odoo_model: "product.template",
          medusa_product_id: first.product.id,
          medusa_variant_id: null,
          source_revision_changed_at: "2026-08-09T12:00:00Z",
          source_revision_product_id: 352,
          sync_state: "succeeded",
          archived: false,
        }),
      ]);
      expect(new Set(mappings.map(({ source_fingerprint }) => source_fingerprint)).size).toEqual(1);
      expect(syncRecords).toEqual([
        expect.objectContaining({
          state: "succeeded",
          attempts: 1,
          medusa_product_id: first.product.id,
          result: expect.objectContaining({
            productId: first.product.id,
            templateCatalogMappingId: first.catalog_import.catalog_mapping_ids.template,
          }),
        }),
      ]);
      expect(linkedProducts).toEqual([
        expect.objectContaining({
          id: first.product.id,
          catalog_mapping: expect.objectContaining({
            id: first.catalog_import.catalog_mapping_ids.template,
          }),
        }),
      ]);
      expect(linkedVariants).toEqual([
        expect.objectContaining({
          id: first.product.variants[0]!.id,
          catalog_mapping: expect.objectContaining({
            id: first.catalog_import.catalog_mapping_ids.variants[0],
          }),
        }),
      ]);
    });

    it("imports every value of one Odoo attribute as a mapped Medusa Variant", async () => {
      const odoo = mockCatalogBatch(singleAttributeCatalogBatch);

      const response = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "single-attribute-product" } },
      );
      const imported = CatalogImportResponseSchema.parse(response.data);

      expect(imported.product.options).toEqual([
        expect.objectContaining({
          title: "Size",
          is_exclusive: true,
          values: [{ value: "250 ml" }, { value: "500 ml" }],
        }),
      ]);
      expect(imported.product.variants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sku: "BODY-WASH-250" }),
          expect.objectContaining({ sku: "BODY-WASH-500" }),
        ]),
      );
      const variantBySku = new Map(
        imported.product.variants.map((variant) => [variant.sku, variant]),
      );
      expect(imported.catalog_import.variants).toEqual([
        expect.objectContaining({
          integration_key: "00000000-0000-4000-8000-000000000901",
          odoo_variant_id: 901,
          medusa_variant_id: variantBySku.get("BODY-WASH-250")?.id,
          disposition: "created",
          availability: "available",
        }),
        expect.objectContaining({
          integration_key: "00000000-0000-4000-8000-000000000902",
          odoo_variant_id: 902,
          medusa_variant_id: variantBySku.get("BODY-WASH-500")?.id,
          disposition: "created",
          availability: "available",
        }),
      ]);
      expect(imported.catalog_import.catalog_mapping_ids.variants).toEqual(
        imported.catalog_import.variants.map(({ catalog_mapping_id }) => catalog_mapping_id),
      );
      expect(odoo.isDone()).toEqual(true);
    });

    it("keeps source-generated options exclusive to each Product", async () => {
      mockCatalogBatch(singleAttributeCatalogBatch);
      const firstResponse = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "shared-size-first" } },
      );
      const first = CatalogImportResponseSchema.parse(firstResponse.data);
      mockCatalogBatch({
        ...singleAttributeCatalogBatch,
        items: [
          {
            ...singleAttributeCatalogBatch.items[0],
            source_revision: { id: 404, write_date: "2026-08-11T13:00:00Z" },
            template: {
              ...singleAttributeCatalogBatch.items[0].template,
              attributes: [
                {
                  ...singleAttributeCatalogBatch.items[0].template.attributes[0],
                  values: [
                    { id: 51, name: "250 ml", template_value_id: 71 },
                    { id: 52, name: "500 ml", template_value_id: 72 },
                  ],
                },
              ],
              id: 404,
              integration_key: "00000000-0000-4000-8000-000000000404",
              name: "SHAMPOO",
            },
            variants: singleAttributeCatalogBatch.items[0].variants.map((variant, index) => ({
              ...variant,
              id: 931 + index,
              integration_key: `00000000-0000-4000-8000-00000000093${index + 1}`,
              name: `SHAMPOO ${index + 1}`,
              barcode: `841234567993${index + 1}`,
              default_code: `SHAMPOO-${index + 1}`,
            })),
          },
        ],
        next_cursor: { id: 404, write_date: "2026-08-11T13:00:00Z" },
      });

      const secondResponse = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "shared-size-second" } },
      );
      const second = CatalogImportResponseSchema.parse(secondResponse.data);
      const catalogSync = getContainer().resolve<CatalogSyncModuleService>(CATALOG_SYNC_MODULE);
      const firstAttributes = await catalogSync.listCatalogAttributeMappings({
        template_catalog_mapping_id: first.catalog_import.catalog_mapping_ids.template,
      });
      const secondAttributes = await catalogSync.listCatalogAttributeMappings({
        template_catalog_mapping_id: second.catalog_import.catalog_mapping_ids.template,
      });

      expect(first.product.options[0]).toMatchObject({ title: "Size", is_exclusive: true });
      expect(second.product.options[0]).toMatchObject({ title: "Size", is_exclusive: true });
      expect(second.product.options[0]!.id).not.toEqual(first.product.options[0]!.id);
      expect(secondAttributes[0]!.id).not.toEqual(firstAttributes[0]!.id);
      expect(secondAttributes[0]!.medusa_product_option_id).toEqual(second.product.options[0]!.id);
    });

    it("returns unchanged for an identical source snapshot under a new operation", async () => {
      mockCatalogBatch(singleAttributeCatalogBatch);
      const initialResponse = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "unchanged-source-initial" } },
      );
      const initial = CatalogImportResponseSchema.parse(initialResponse.data);
      mockCatalogBatch(singleAttributeCatalogBatch);

      const repeatedResponse = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "unchanged-source-repeat" } },
      );
      const repeated = CatalogImportResponseSchema.parse(repeatedResponse.data);

      expect(repeated.catalog_import.disposition).toEqual("unchanged");
      expect(repeated.product).toEqual(initial.product);
      expect(repeated.catalog_import.catalog_mapping_ids).toEqual(
        initial.catalog_import.catalog_mapping_ids,
      );
      expect(repeated.catalog_import.variants).toEqual(
        initial.catalog_import.variants.map((variant) =>
          expect.objectContaining({
            integration_key: variant.integration_key,
            medusa_variant_id: variant.medusa_variant_id,
            catalog_mapping_id: variant.catalog_mapping_id,
            disposition: "unchanged",
          }),
        ),
      );
      expect(odooCalls).toHaveLength(2);
    });

    it("hydrates source snapshots created before the multi-Variant migration", async () => {
      mockCatalogBatch(validCatalogBatch);
      const initialResponse = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "legacy-snapshot-initial" } },
      );
      const initial = CatalogImportResponseSchema.parse(initialResponse.data);
      const catalogSync = getContainer().resolve<CatalogSyncModuleService>(CATALOG_SYNC_MODULE);
      const mappings = await catalogSync.listCatalogMappings({
        medusa_product_id: initial.product.id,
      });
      await catalogSync.updateCatalogMappings(
        mappings.map((mapping) => ({
          id: mapping.id,
          source_label: "",
          source_internal_reference: null,
          source_barcode: null,
        })),
      );
      mockCatalogBatch(validCatalogBatch);

      const hydratedResponse = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "legacy-snapshot-hydrate" } },
      );
      const hydrated = CatalogImportResponseSchema.parse(hydratedResponse.data);
      const hydratedMappings = await catalogSync.listCatalogMappings({
        medusa_product_id: initial.product.id,
      });
      const templateMapping = hydratedMappings.find(
        ({ odoo_model }) => odoo_model === "product.template",
      );
      const variantMapping = hydratedMappings.find(
        ({ odoo_model }) => odoo_model === "product.product",
      );

      expect(hydrated.catalog_import.disposition).toEqual("updated");
      expect(templateMapping?.source_label).toEqual("A-TOPIC GEL");
      expect(variantMapping).toMatchObject({
        source_label: "A-TOPIC GEL",
        source_internal_reference: "ATOPIC-001",
        source_barcode: "8412345678901",
      });
    });

    it("imports the complete multi-attribute Odoo combination set", async () => {
      mockCatalogBatch(multiAttributeCatalogBatch);

      const response = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "multi-attribute-product" } },
      );
      const imported = CatalogImportResponseSchema.parse(response.data);

      expect(imported.product.options).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            title: "Size",
            values: expect.arrayContaining([{ value: "250 ml" }, { value: "500 ml" }]),
          }),
          expect.objectContaining({
            title: "Scent",
            values: expect.arrayContaining([{ value: "Unscented" }, { value: "Citrus" }]),
          }),
        ]),
      );
      expect(imported.product.variants).toHaveLength(4);
      expect(imported.catalog_import.variants).toHaveLength(4);
      expect(
        imported.catalog_import.variants.map(({ odoo_variant_id }) => odoo_variant_id),
      ).toEqual([910, 911, 912, 913]);
      const productService = getContainer().resolve<IProductModuleService>(Modules.PRODUCT);
      const product = await productService.retrieveProduct(imported.product.id, {
        relations: ["variants.options"],
      });
      expect(
        product.variants
          ?.map((variant) => ({
            sku: variant.sku,
            values: variant.options?.map(({ value }) => value).sort(),
          }))
          .sort((left, right) => left.sku!.localeCompare(right.sku!)),
      ).toEqual([
        { sku: "HAND-SOAP-910", values: ["250 ml", "Unscented"] },
        { sku: "HAND-SOAP-911", values: ["250 ml", "Citrus"].sort() },
        { sku: "HAND-SOAP-912", values: ["500 ml", "Unscented"] },
        { sku: "HAND-SOAP-913", values: ["500 ml", "Citrus"].sort() },
      ]);
      const catalogSync = getContainer().resolve<CatalogSyncModuleService>(CATALOG_SYNC_MODULE);
      const attributes = await catalogSync.listCatalogAttributeMappings({
        template_catalog_mapping_id: imported.catalog_import.catalog_mapping_ids.template,
      });
      const values = await catalogSync.listCatalogAttributeValueMappings({
        catalog_attribute_mapping_id: attributes.map(({ id }) => id),
      });
      const selections = await catalogSync.listCatalogVariantAttributeValues({
        variant_catalog_mapping_id: imported.catalog_import.catalog_mapping_ids.variants,
      });

      expect(
        attributes
          .map(({ odoo_attribute_id }) => odoo_attribute_id)
          .sort((left, right) => left - right),
      ).toEqual([41, 42]);
      expect(
        values
          .map(({ odoo_attribute_value_id }) => odoo_attribute_value_id)
          .sort((left, right) => left - right),
      ).toEqual([51, 52, 53, 54]);
      expect(
        values.every(({ medusa_product_option_value_id }) => medusa_product_option_value_id),
      ).toEqual(true);
      expect(selections).toHaveLength(8);
    });

    it("keeps dynamic options hidden and never attributes in source mappings", async () => {
      mockCatalogBatch(dynamicAndNeverCatalogBatch);

      const response = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "dynamic-never-product" } },
      );
      const imported = CatalogImportResponseSchema.parse(response.data);
      const catalogSync = getContainer().resolve<CatalogSyncModuleService>(CATALOG_SYNC_MODULE);
      const attributes = await catalogSync.listCatalogAttributeMappings(
        { template_catalog_mapping_id: imported.catalog_import.catalog_mapping_ids.template },
        { order: { odoo_attribute_id: "ASC" } },
      );
      const mappings = await catalogSync.listCatalogMappings({
        medusa_product_id: imported.product.id,
      });

      expect(imported.product.options).toEqual([
        expect.objectContaining({
          title: "Finish",
          metadata: { mze_hidden: true, mze_source_generated: true },
          values: expect.arrayContaining([{ value: "Matte" }, { value: "Gloss" }]),
        }),
      ]);
      expect(attributes).toEqual([
        expect.objectContaining({
          odoo_attribute_id: 43,
          source_label: "Finish",
          variant_creation_mode: "dynamic",
          medusa_product_option_id: imported.product.options[0]!.id,
        }),
        expect.objectContaining({
          odoo_attribute_id: 44,
          source_label: "Gift message",
          variant_creation_mode: "never",
          medusa_product_option_id: null,
        }),
      ]);
      expect(mappings).toContainEqual(
        expect.objectContaining({
          odoo_database_id: 921,
          archived: true,
        }),
      );
      expect(imported.catalog_import.variants[1]).toMatchObject({
        odoo_variant_id: 921,
        availability: "unavailable",
      });
    });

    it("creates a new Medusa Variant only for a new Odoo Variant identity", async () => {
      mockCatalogBatch(dynamicInitialCatalogBatch);
      const initialResponse = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "dynamic-new-variant-initial" } },
      );
      const initial = CatalogImportResponseSchema.parse(initialResponse.data);
      mockCatalogBatch(dynamicNewVariantCatalogBatch);

      const updatedResponse = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "dynamic-new-variant-added" } },
      );
      const updated = CatalogImportResponseSchema.parse(updatedResponse.data);

      expect(updated.product.id).toEqual(initial.product.id);
      expect(updated.catalog_import.variants).toEqual([
        expect.objectContaining({
          integration_key: "00000000-0000-4000-8000-000000000920",
          medusa_variant_id: initial.catalog_import.variants[0]!.medusa_variant_id,
          disposition: "updated",
        }),
        expect.objectContaining({
          integration_key: "00000000-0000-4000-8000-000000000922",
          disposition: "created",
        }),
      ]);
      expect(updated.catalog_import.variants[1]!.medusa_variant_id).not.toEqual(
        initial.catalog_import.variants[0]!.medusa_variant_id,
      );
      expect(updated.product.variants).toHaveLength(2);
      expect(updated.product.options[0]!.values).toEqual(
        expect.arrayContaining([{ value: "Matte" }, { value: "Gloss" }, { value: "Satin" }]),
      );
      expect(updated.product.status).toEqual("draft");
    });

    it("preserves stable mappings through source identity-field changes and archive cycles", async () => {
      mockCatalogBatch(singleAttributeCatalogBatch);
      const initialResponse = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "identity-cycle-initial" } },
      );
      const initial = CatalogImportResponseSchema.parse(initialResponse.data);
      mockCatalogBatch(changedIdentityCatalogBatch);

      const changedResponse = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "identity-cycle-changed" } },
      );
      const changed = CatalogImportResponseSchema.parse(changedResponse.data);

      expect(changed.catalog_import.disposition).toEqual("updated");
      expect(changed.product.id).toEqual(initial.product.id);
      expect(changed.product.title).toEqual("BODY WASH");
      expect(changed.product.options).toEqual(initial.product.options);
      expect(changed.product.variants).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: initial.catalog_import.variants[0]!.medusa_variant_id,
            sku: "BODY-WASH-250-NEW",
            barcode: "8412345679901",
          }),
          expect.objectContaining({
            id: initial.catalog_import.variants[1]!.medusa_variant_id,
            sku: "BODY-WASH-500-NEW",
            barcode: "8412345679902",
          }),
        ]),
      );
      expect(changed.catalog_import.catalog_mapping_ids).toEqual(
        initial.catalog_import.catalog_mapping_ids,
      );
      expect(changed.catalog_import.variants).toEqual([
        expect.objectContaining({
          medusa_variant_id: initial.catalog_import.variants[0]!.medusa_variant_id,
          disposition: "updated",
          availability: "available",
        }),
        expect.objectContaining({
          medusa_variant_id: initial.catalog_import.variants[1]!.medusa_variant_id,
          disposition: "archived",
          availability: "unavailable",
        }),
      ]);

      const catalogSync = getContainer().resolve<CatalogSyncModuleService>(CATALOG_SYNC_MODULE);
      const attributes = await catalogSync.listCatalogAttributeMappings({
        template_catalog_mapping_id: initial.catalog_import.catalog_mapping_ids.template,
      });
      const values = await catalogSync.listCatalogAttributeValueMappings({
        catalog_attribute_mapping_id: attributes.map(({ id }) => id),
      });
      expect(attributes).toEqual([
        expect.objectContaining({
          odoo_attribute_id: 41,
          source_label: "Volume",
          medusa_product_option_id: initial.product.options[0]!.id,
        }),
      ]);
      expect(values).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ odoo_attribute_value_id: 51, source_label: "Small" }),
          expect.objectContaining({ odoo_attribute_value_id: 52, source_label: "Large" }),
        ]),
      );

      mockCatalogBatch(reactivatedIdentityCatalogBatch);
      const reactivatedResponse = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "identity-cycle-reactivated" } },
      );
      const reactivated = CatalogImportResponseSchema.parse(reactivatedResponse.data);

      expect(reactivated.product.id).toEqual(initial.product.id);
      expect(reactivated.catalog_import.variants[1]).toMatchObject({
        medusa_variant_id: initial.catalog_import.variants[1]!.medusa_variant_id,
        catalog_mapping_id: initial.catalog_import.variants[1]!.catalog_mapping_id,
        disposition: "reactivated",
        availability: "available",
      });
    });

    it("makes all Variants unavailable when the Odoo template is archived", async () => {
      mockCatalogBatch(singleAttributeCatalogBatch);
      const initialResponse = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "template-cycle-initial" } },
      );
      const initial = CatalogImportResponseSchema.parse(initialResponse.data);
      mockCatalogBatch(archivedTemplateCatalogBatch);

      const archivedResponse = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "template-cycle-archived" } },
      );
      const archived = CatalogImportResponseSchema.parse(archivedResponse.data);

      expect(archived.catalog_import.variants).toEqual(
        initial.catalog_import.variants.map((variant) =>
          expect.objectContaining({
            medusa_variant_id: variant.medusa_variant_id,
            disposition: "archived",
            availability: "unavailable",
          }),
        ),
      );
      const catalogSync = getContainer().resolve<CatalogSyncModuleService>(CATALOG_SYNC_MODULE);
      const archivedMappings = await catalogSync.listCatalogMappings({
        medusa_product_id: initial.product.id,
      });
      expect(archivedMappings.every(({ archived: unavailable }) => unavailable)).toEqual(true);
      mockCatalogBatch(reactivatedTemplateCatalogBatch);

      const reactivatedResponse = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "template-cycle-reactivated" } },
      );
      const reactivated = CatalogImportResponseSchema.parse(reactivatedResponse.data);

      expect(reactivated.catalog_import.variants).toEqual(
        initial.catalog_import.variants.map((variant) =>
          expect.objectContaining({
            medusa_variant_id: variant.medusa_variant_id,
            disposition: "reactivated",
            availability: "available",
          }),
        ),
      );
    });

    it("rejects a mapped Variant that disappears from a complete Catalog Item", async () => {
      mockCatalogBatch(singleAttributeCatalogBatch);
      const initialResponse = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "missing-variant-initial" } },
      );
      const initial = CatalogImportResponseSchema.parse(initialResponse.data);
      mockCatalogBatch({
        ...singleAttributeCatalogBatch,
        items: [
          {
            ...singleAttributeCatalogBatch.items[0],
            source_revision: { id: 401, write_date: "2026-08-17T12:00:00Z" },
            variants: [singleAttributeCatalogBatch.items[0].variants[0]],
          },
        ],
      });

      await expect(
        api.post(
          "/admin/odoo/catalog-imports",
          {},
          { headers: { ...operator.headers, "Idempotency-Key": "missing-variant-resync" } },
        ),
      ).rejects.toMatchObject({ response: { status: 409 } });

      const catalogSync = getContainer().resolve<CatalogSyncModuleService>(CATALOG_SYNC_MODULE);
      const mappings = await catalogSync.listCatalogMappings({
        medusa_product_id: initial.product.id,
      });
      const records = await catalogSync.listSyncRecords({
        operation_id: "catalog-import--missing-variant-resync",
      });
      const productService = getContainer().resolve<IProductModuleService>(Modules.PRODUCT);
      const product = await productService.retrieveProduct(initial.product.id, {
        relations: ["variants"],
      });

      expect(mappings).toHaveLength(3);
      expect(product.variants).toHaveLength(2);
      expect(records).toEqual([
        expect.objectContaining({
          state: "failed",
          error_code: "catalog_source_missing_variant",
        }),
      ]);
    });

    it("rejects another request fingerprint before it calls Odoo", async () => {
      const odoo = mockCatalogBatch();
      const request = {
        headers: { ...operator.headers, "Idempotency-Key": "changed-cursor" },
      };

      await api.post("/admin/odoo/catalog-imports", {}, request);

      await expect(
        api.post(
          "/admin/odoo/catalog-imports",
          { cursor: { id: 999, write_date: "2026-08-10T10:00:00Z" } },
          request,
        ),
      ).rejects.toMatchObject({ response: { status: 409 } });
      expect(odoo.isDone()).toEqual(true);
      expect(odooCalls).toHaveLength(1);
    });

    it.each([
      [
        "missing Integration Key",
        {
          ...validCatalogBatch,
          items: [
            {
              ...validCatalogBatch.items[0],
              template: {
                ...validCatalogBatch.items[0].template,
                integration_key: undefined,
              },
            },
          ],
        },
      ],
      [
        "duplicate Integration Key",
        {
          ...validCatalogBatch,
          items: [
            {
              ...validCatalogBatch.items[0],
              variants: [
                {
                  ...validCatalogBatch.items[0].variants[0],
                  integration_key: TEMPLATE_INTEGRATION_KEY,
                },
              ],
            },
          ],
        },
      ],
      ["malformed payload", { contract_version: "mze.odoo.catalog.v1", items: "invalid" }],
    ])("records a visible failure for a %s without a partial Product", async (_, body) => {
      const productService = getContainer().resolve<IProductModuleService>(Modules.PRODUCT);
      const [, productCountBefore] = await productService.listAndCountProducts();
      const odoo = mockCatalogBatch(body);
      const key = `invalid-source-${String(_).replaceAll(" ", "-")}`;
      const request = { headers: { ...operator.headers, "Idempotency-Key": key } };

      await expect(api.post("/admin/odoo/catalog-imports", {}, request)).rejects.toMatchObject({
        response: { status: 400 },
      });
      await expect(api.post("/admin/odoo/catalog-imports", {}, request)).rejects.toMatchObject({
        response: { status: 400 },
      });

      const catalogSync = getContainer().resolve<CatalogSyncModuleService>(CATALOG_SYNC_MODULE);
      const syncRecords = await catalogSync.listSyncRecords({
        operation_id: `catalog-import--${key}`,
      });
      const [, productCountAfter] = await productService.listAndCountProducts();

      expect(odoo.isDone()).toEqual(true);
      expect(odooCalls).toHaveLength(1);
      expect(productCountAfter).toEqual(productCountBefore);
      expect(syncRecords).toEqual([
        expect.objectContaining({
          state: "failed",
          attempts: 1,
          error_code: "catalog_source_rejected",
        }),
      ]);
    });

    it("rejects a changed Integration Key for an already mapped Odoo database ID", async () => {
      const productService = getContainer().resolve<IProductModuleService>(Modules.PRODUCT);
      const [, productCountBefore] = await productService.listAndCountProducts();
      const firstOdoo = mockCatalogBatch();

      await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "first-source-identity" } },
      );
      const [, productCountAfterFirst] = await productService.listAndCountProducts();
      const duplicateOdoo = mockCatalogBatch({
        ...validCatalogBatch,
        items: [
          {
            ...validCatalogBatch.items[0],
            variants: [
              {
                ...validCatalogBatch.items[0].variants[0],
                integration_key: "00000000-0000-4000-8000-000000000999",
              },
            ],
          },
        ],
      });

      await expect(
        api.post(
          "/admin/odoo/catalog-imports",
          {},
          { headers: { ...operator.headers, "Idempotency-Key": "duplicate-source-identity" } },
        ),
      ).rejects.toMatchObject({ response: { status: 409 } });

      const [, productCountAfterDuplicate] = await productService.listAndCountProducts();
      const catalogSync = getContainer().resolve<CatalogSyncModuleService>(CATALOG_SYNC_MODULE);
      const syncRecords = await catalogSync.listSyncRecords({
        operation_id: "catalog-import--duplicate-source-identity",
      });
      expect(productCountAfterFirst).toEqual(productCountBefore + 1);
      expect(productCountAfterDuplicate).toEqual(productCountAfterFirst);
      expect(syncRecords).toEqual([
        expect.objectContaining({
          state: "failed",
          error_code: "catalog_identity_conflict",
        }),
      ]);
      expect(firstOdoo.isDone()).toEqual(true);
      expect(duplicateOdoo.isDone()).toEqual(true);
      expect(odooCalls).toHaveLength(2);
    });

    it("keeps Product and Cart Store API requests independent from Odoo", async () => {
      const storeRequest = { headers: { "x-publishable-api-key": probe.publishableKey } };

      const productResponse = await api.get(
        `/store/products/${probe.productId}?region_id=${seeded.regionId}`,
        storeRequest,
      );
      const cartResponse = await api.post(
        "/store/carts",
        { region_id: seeded.regionId },
        storeRequest,
      );

      expect(productResponse.status).toEqual(200);
      expect(cartResponse.status).toEqual(200);
      expect(odooCalls).toHaveLength(0);
    });
  },
});
