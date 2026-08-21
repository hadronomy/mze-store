import type { IProductModuleService } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import type { CatalogBatchEncoded } from "@mze-store/odoo-bridge/contract";
import { CATALOG_SYNC_MODULE } from "~/modules/catalog-sync";
import type CatalogSyncModuleService from "~/modules/catalog-sync/service";
import { seedTerritoryProbe, type SeededProbe } from "~/territory/probe";
import { seedTerritory, type SeededTerritory } from "~/territory/seed";
import { SPAIN_DECLARATION } from "~/territory/spain";
import { signInAsOperator } from "../utils/operator";

jest.setTimeout(120 * 1000);

const ODOO_ORIGIN = "https://odoo.eden.mizonaecologica.es";
const ODOO_CATALOG_PATH = "/json/2/mze.medusa.bridge/read_catalog_batch";
const TEMPLATE_INTEGRATION_KEY = "3f8c5e48-4aa9-4a77-b4f4-1f9ff22e1182";
const VARIANT_INTEGRATION_KEY = "5aa969c0-8eb2-4a68-a093-8e0f9bd66f52";

const CatalogImportResponseSchema = z.object({
  product: z.object({
    id: z.string(),
    title: z.string(),
    status: z.literal("draft"),
    options: z.array(
      z.object({
        title: z.string(),
        is_exclusive: z.boolean(),
        metadata: z.record(z.string(), z.unknown()).nullable(),
        values: z.array(z.object({ value: z.string() })),
      }),
    ),
    variants: z.array(
      z.object({
        id: z.string(),
        sku: z.string().nullable(),
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
    disposition: z.enum(["created", "replayed"]),
    operation_id: z.string(),
    sync_record_id: z.string(),
    catalog_mapping_ids: z.object({ template: z.string(), variant: z.string() }),
    source_revision: z.object({
      id: z.number().int().positive(),
      write_date: z.string().datetime({ offset: true }),
    }),
    next_cursor: z
      .object({
        id: z.number().int().positive(),
        write_date: z.string().datetime({ offset: true }),
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
  if (request.url !== `${ODOO_ORIGIN}${ODOO_CATALOG_PATH}` || request.method !== "POST") {
    throw new Error(`Unexpected Odoo request to ${request.method} ${request.url}.`);
  }
  if (
    request.headers.get("authorization") !== "Bearer test-placeholder-api-key" ||
    request.headers.get("x-odoo-database") !== "odoo"
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
          medusa_variant_id: first.product.variants[0]!.id,
          template_catalog_mapping_id: first.catalog_import.catalog_mapping_ids.template,
          variant_catalog_mapping_id: first.catalog_import.catalog_mapping_ids.variant,
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
            id: first.catalog_import.catalog_mapping_ids.variant,
          }),
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

    it("rejects an Integration Key that is already mapped without another Product", async () => {
      const productService = getContainer().resolve<IProductModuleService>(Modules.PRODUCT);
      const [, productCountBefore] = await productService.listAndCountProducts();
      const firstOdoo = mockCatalogBatch();

      await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "first-source-identity" } },
      );
      const [, productCountAfterFirst] = await productService.listAndCountProducts();
      const duplicateOdoo = mockCatalogBatch();

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
