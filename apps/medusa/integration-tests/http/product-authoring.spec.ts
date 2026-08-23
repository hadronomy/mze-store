import type { MedusaContainer } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { z } from "@medusajs/framework/zod";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { linkProductsToSalesChannelWorkflow } from "@medusajs/medusa/core-flows";
import { CATALOG_SYNC_MODULE, type CatalogSyncModule } from "~/modules/catalog-sync";
import {
  PRODUCT_AUTHORING_MODULE,
  type ProductAuthoringModuleService,
} from "~/modules/product-authoring";
import { seedTerritory, type SeededTerritory } from "~/territory/seed";
import { seedTerritoryProbe, type SeededProbe } from "~/territory/probe";
import { SPAIN_DECLARATION } from "~/territory/spain";
import { signInAsOperator } from "../utils/operator";

jest.setTimeout(120 * 1000);

const ODOO_CATALOG_PATH = "/json/2/mze.medusa.bridge/read_catalog_batch";
const TEMPLATE_KEY = "7f3a9b1c-4aa9-4a77-b4f4-1f9ff22e1182";
const VARIANT_KEY = "8b4c0d2e-8eb2-4a68-a093-8e0f9bd66f52";

const ProductAuthoringResponseSchema = z.object({
  id: z.string(),
  state: z.enum(["imported", "authoring", "ready", "published", "blocked"]),
  blocked_reason: z.string().nullable(),
  seo_title: z.string().nullable(),
  seo_description: z.string().nullable(),
  colour: z.string().nullable(),
  merchandising_rank: z.number().int().min(0),
});

type JsonInput =
  | boolean
  | null
  | number
  | string
  | readonly JsonInput[]
  | { readonly [key: string]: JsonInput | undefined };

type OdooResponse = { body: JsonInput; consumed: boolean };
type OdooScope = { isDone(): boolean };

function authoringBatch(
  options: {
    active?: boolean;
    renamed?: boolean;
    templateIntegrationKey?: string;
    variantActive?: boolean;
  } = {},
) {
  const active = options.active ?? true;
  const templateName = options.renamed ? "AUTHORING PROBE SOURCE RENAMED" : "AUTHORING PROBE";
  const variantCode = options.renamed ? "AUTHOR-001-RENAMED" : "AUTHOR-001";

  return {
    contract_version: "mze.odoo.catalog.v1",
    items: [
      {
        source_revision: { id: 501, write_date: "2026-08-20T10:00:00Z" },
        template: {
          active,
          attributes: [],
          description: "Seeded source description",
          id: 501,
          integration_key: options.templateIntegrationKey ?? TEMPLATE_KEY,
          media: [],
          model: "product.template",
          name: templateName,
          sale_ok: true,
          taxes: [],
          write_date: "2026-08-19T09:00:00Z",
        },
        variants: [
          {
            active: options.variantActive ?? true,
            attribute_values: [],
            barcode: "8412345600101",
            default_code: variantCode,
            id: 601,
            integration_key: VARIANT_KEY,
            media: [],
            model: "product.product",
            name: templateName,
            price: "15.00",
            price_rule_id: null,
            sale_ok: true,
            write_date: "2026-08-19T09:00:00Z",
          },
        ],
      },
    ],
    next_cursor: { id: 501, write_date: "2026-08-20T10:00:00Z" },
    price_list: { currency: "EUR", id: 1, name: "Public Pricelist" },
    priced_at: "2026-08-20T11:00:00Z",
  };
}

const nativeFetch = globalThis.fetch;
const odooResponses: OdooResponse[] = [];

const odooFetch: typeof globalThis.fetch = async (input, init) => {
  const request = new Request(input, init);
  if (!request.url.endsWith(ODOO_CATALOG_PATH)) {
    throw new Error(`Unexpected request ${request.method} ${request.url}.`);
  }

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
  testSuite: function productAuthoringTestSuite({ api, getContainer }) {
    let operator: Awaited<ReturnType<typeof signInAsOperator>>;
    let territory: SeededTerritory;
    let probe: SeededProbe;

    beforeAll(async () => {
      globalThis.fetch = odooFetch;
      operator = await signInAsOperator(getContainer(), api, {
        email: "product-authoring-operator@mze.store",
        password: "supersecret",
      });
      territory = await seedTerritory(getContainer(), SPAIN_DECLARATION);
      probe = await seedTerritoryProbe(getContainer(), territory);
    });

    beforeEach(() => {
      odooResponses.length = 0;
    });

    afterEach(() => {
      expect(odooResponses).toHaveLength(0);
    });

    afterAll(() => {
      globalThis.fetch = nativeFetch;
    });

    function mockCatalogBatch(body: JsonInput): OdooScope {
      const response = { body, consumed: false };
      odooResponses.push(response);

      return { isDone: () => response.consumed };
    }

    async function importProbe(key: string): Promise<string> {
      mockCatalogBatch(authoringBatch());
      const response = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": key } },
      );

      return response.data.product.id as string;
    }

    async function setAuthoring(
      productId: string,
      body: {
        state?: "authoring" | "ready" | "blocked";
        blocked_reason?: string | null;
        seo_title?: string;
        colour?: string;
        merchandising_rank?: number;
      },
    ): Promise<z.infer<typeof ProductAuthoringResponseSchema>> {
      const response = await api.put(`/admin/products/${productId}/authoring`, body, {
        headers: operator.headers,
      });

      return ProductAuthoringResponseSchema.parse(response.data.product_authoring);
    }

    async function promote(productId: string, idempotencyKey?: string): Promise<any> {
      return api.post(
        `/admin/products/${productId}/promote`,
        {},
        {
          headers: {
            ...operator.headers,
            "Idempotency-Key": idempotencyKey,
          },
        },
      );
    }

    async function getProductStatus(
      container: MedusaContainer,
      productId: string,
    ): Promise<string> {
      const productService = container.resolve<any>(Modules.PRODUCT);
      const product = await productService.retrieveProduct(productId);

      return String(product.status);
    }

    async function fetchStoreProduct(
      token: string,
      productId: string,
    ): Promise<{ id: string; status: string }> {
      // The Store API filters by Sales Channel through the publishable key.
      const response = await api
        .get(`/store/products/${productId}?region_id=${territory.regionId}&fields=id,status`, {
          headers: { "x-publishable-api-key": token },
        })
        .catch((error: { response?: { status: number; data: unknown } }) => {
          // Surface the response body so a failing assertion names its cause.
          throw new Error(
            `store fetch failed ${error.response?.status}: ${JSON.stringify(error.response?.data)}`,
          );
        });

      return { id: response.data.product.id, status: response.data.product.status };
    }

    async function linkToChannel(container: MedusaContainer, productId: string): Promise<void> {
      await linkProductsToSalesChannelWorkflow(container).run({
        input: { id: territory.salesChannelId, add: [productId] },
      });
    }

    it("keeps Medusa-owned editorial fields when an Odoo resync changes source fields", async () => {
      const productId = await importProbe("authoring-resync-initial");
      const productService = getContainer().resolve<any>(Modules.PRODUCT);
      const imported = await productService.retrieveProduct(productId, {
        relations: ["variants"],
      });
      const variantId = imported.variants[0].id as string;
      await api.post(
        `/admin/products/${productId}/variants/${variantId}`,
        { title: "Operator Variant Title" },
        { headers: operator.headers },
      );
      await productService.updateProducts(productId, {
        title: "Operator Title",
        description: "Operator description that must survive.",
      });
      await setAuthoring(productId, {
        state: "ready",
        seo_title: "Buy Operator Title",
        colour: "amber",
        merchandising_rank: 7,
      });

      mockCatalogBatch(authoringBatch({ renamed: true }));
      const resynced = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "authoring-resync-changed" } },
      );
      expect(resynced.data.catalog_import.disposition).toEqual("updated");

      const product = await productService.retrieveProduct(productId, {
        relations: ["variants"],
      });
      expect(product.title).toEqual("Operator Title");
      expect(product.description).toEqual("Operator description that must survive.");
      expect(product.variants[0].title).toEqual("Operator Variant Title");

      const authoring =
        getContainer().resolve<ProductAuthoringModuleService>(PRODUCT_AUTHORING_MODULE);
      const record = await authoring.getAuthoring(productId);
      expect(record?.state).toEqual("ready");
      expect(record?.seoTitle).toEqual("Buy Operator Title");
      expect(record?.colour).toEqual("amber");
      expect(record?.merchandisingRank).toEqual(7);
    });

    it("promotes a ready Product through the gate and projects availability", async () => {
      const productId = await importProbe("authoring-promote");
      await linkToChannel(getContainer(), productId);
      const productService = getContainer().resolve<any>(Modules.PRODUCT);
      await productService.updateProducts(productId, {
        title: "Promotable Product",
        description: "Meets every promotion gate.",
        images: [{ url: "https://assets.mze.store/ground/probe.jpg" }],
      });

      // Promotion requires the explicit `ready` state.
      await setAuthoring(productId, { state: "ready" });
      await setAuthoring(productId, { state: "authoring" });
      await expect(promote(productId)).rejects.toMatchObject({
        response: { status: 400, data: { code: "authoring_state_conflict" } },
      });

      await setAuthoring(productId, { state: "ready" });
      const promotions = await Promise.all([promote(productId), promote(productId)]);
      expect(promotions).toEqual([
        expect.objectContaining({ status: 200 }),
        expect.objectContaining({ status: 200 }),
      ]);

      expect(await getProductStatus(getContainer(), productId)).toEqual("published");

      const visible = await fetchStoreProduct(probe.publishableKey, productId);
      expect(visible).toMatchObject({ id: productId, status: "published" });

      const authoring =
        getContainer().resolve<ProductAuthoringModuleService>(PRODUCT_AUTHORING_MODULE);
      expect((await authoring.getAuthoring(productId))?.state).toEqual("published");

      const replayKey = "authoring-promote-replay";
      await expect(promote(productId, replayKey)).resolves.toMatchObject({ status: 200 });
      await expect(promote(productId, replayKey)).resolves.toMatchObject({ status: 200 });
    });

    it("requires the promotion workflow for native Admin Product publishing", async () => {
      const productId = await importProbe("authoring-native-publish-gate");

      await expect(
        api.post(
          `/admin/products/${productId}`,
          { status: "published" },
          { headers: operator.headers },
        ),
      ).rejects.toMatchObject({
        response: {
          status: 400,
          data: { code: "authoring_promotion_required" },
        },
      });
      expect(await getProductStatus(getContainer(), productId)).toEqual("draft");

      await expect(
        api.post(
          "/admin/products",
          { title: "Native Published Product", status: "published" },
          { headers: operator.headers },
        ),
      ).rejects.toMatchObject({
        response: {
          status: 400,
          data: { code: "authoring_promotion_required" },
        },
      });

      await expect(
        api.post(
          "/admin/products/batch",
          { update: [{ id: productId, status: "published" }] },
          { headers: operator.headers },
        ),
      ).rejects.toMatchObject({
        response: {
          status: 400,
          data: { code: "authoring_promotion_required" },
        },
      });

      await expect(
        api.post(
          "/admin/products/batch",
          { create: [{ title: "Batch Published Product", status: "published" }] },
          { headers: operator.headers },
        ),
      ).rejects.toMatchObject({
        response: {
          status: 400,
          data: { code: "authoring_promotion_required" },
        },
      });
    });

    it("restores Authoring intent when a mapped Product has no Authoring record", async () => {
      const productId = await importProbe("authoring-legacy-initial");
      const productService = getContainer().resolve<any>(Modules.PRODUCT);
      await productService.updateProducts(productId, {
        title: "Legacy Authoring Product",
        description: "A resync must preserve its published intent.",
        images: [{ url: "https://assets.mze.store/ground/legacy.jpg" }],
      });
      await setAuthoring(productId, { state: "ready" });
      await promote(productId);

      const authoring =
        getContainer().resolve<ProductAuthoringModuleService>(PRODUCT_AUTHORING_MODULE);
      const [record] = await authoring.listProductAuthorings({ product_id: productId });
      expect(record).toBeDefined();
      await authoring.deleteProductAuthorings(record!.id);

      const catalogSync = getContainer().resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
      const finishSync = catalogSync.finishSync.bind(catalogSync);
      catalogSync.finishSync = async () => {
        throw new Error("The Sync Record store is temporarily unavailable.");
      };
      mockCatalogBatch(authoringBatch({ renamed: true }));
      try {
        await expect(
          api.post(
            "/admin/odoo/catalog-imports",
            {},
            {
              headers: {
                ...operator.headers,
                "Idempotency-Key": "authoring-legacy-resync-failed",
              },
            },
          ),
        ).rejects.toBeDefined();
      } finally {
        catalogSync.finishSync = finishSync;
      }
      await expect(authoring.getAuthoring(productId)).resolves.toBeNull();

      mockCatalogBatch(authoringBatch({ renamed: true }));
      await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "authoring-legacy-resync" } },
      );

      await expect(authoring.getAuthoring(productId)).resolves.toMatchObject({
        state: "published",
      });
      expect(await getProductStatus(getContainer(), productId)).toEqual("published");
    });

    it("round-trips a blocked reason and rejects invalid state pairs", async () => {
      const productId = await importProbe("authoring-blocked-reason");

      await expect(setAuthoring(productId, { state: "blocked" })).rejects.toMatchObject({
        response: { status: 400, data: { code: "authoring_blocked_reason_invalid" } },
      });

      const blocked = await setAuthoring(productId, {
        state: "blocked",
        blocked_reason: "The Product Ground needs a replacement image.",
      });
      expect(blocked).toMatchObject({
        state: "blocked",
        blocked_reason: "The Product Ground needs a replacement image.",
      });

      await expect(
        setAuthoring(productId, {
          state: "ready",
          blocked_reason: "This reason cannot survive a ready state.",
        }),
      ).rejects.toMatchObject({
        response: { status: 400, data: { code: "authoring_blocked_reason_invalid" } },
      });

      await expect(setAuthoring(productId, { state: "ready" })).resolves.toMatchObject({
        state: "ready",
        blocked_reason: null,
      });
    });

    it("takes a Product offline when an Operator demotes its Authoring State", async () => {
      const productId = await importProbe("authoring-demotion");
      const productService = getContainer().resolve<any>(Modules.PRODUCT);
      await productService.updateProducts(productId, {
        title: "Demotion Product",
        description: "Meets every promotion gate.",
        images: [{ url: "https://assets.mze.store/ground/demotion.jpg" }],
      });
      await setAuthoring(productId, { state: "ready" });
      await promote(productId);
      expect(await getProductStatus(getContainer(), productId)).toEqual("published");

      await setAuthoring(productId, { state: "authoring" });

      expect(await getProductStatus(getContainer(), productId)).toEqual("draft");
    });

    it("rejects promotion while the Odoo Product source is unavailable", async () => {
      mockCatalogBatch(authoringBatch({ active: false }));
      const imported = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        {
          headers: {
            ...operator.headers,
            "Idempotency-Key": "authoring-unavailable-promotion",
          },
        },
      );
      const productId = imported.data.product.id as string;
      const productService = getContainer().resolve<any>(Modules.PRODUCT);
      await productService.updateProducts(productId, {
        title: "Unavailable Product",
        description: "The source is not available for sale.",
        images: [{ url: "https://assets.mze.store/ground/unavailable.jpg" }],
      });
      await setAuthoring(productId, { state: "ready" });

      await expect(promote(productId)).rejects.toMatchObject({
        response: { status: 400, data: { code: "authoring_source_unavailable" } },
      });
    });

    it("blocks promotion after a failed resync until a later resync succeeds", async () => {
      const productId = await importProbe("authoring-failed-sync-initial");
      const productService = getContainer().resolve<any>(Modules.PRODUCT);
      await productService.updateProducts(productId, {
        title: "Failed Sync Recovery Product",
        description: "The last complete Catalog projection remains valid.",
        images: [{ url: "https://assets.mze.store/ground/failed-sync.jpg" }],
      });

      const invalid = authoringBatch();
      mockCatalogBatch({
        ...invalid,
        items: [
          {
            ...invalid.items[0],
            variants: [
              ...invalid.items[0].variants,
              {
                ...invalid.items[0].variants[0],
                id: 602,
                integration_key: "00000000-0000-4000-8000-000000000602",
                barcode: "8412345600102",
                default_code: "AUTHOR-002",
              },
            ],
          },
        ],
      });
      await expect(
        api.post(
          "/admin/odoo/catalog-imports",
          {},
          {
            headers: {
              ...operator.headers,
              "Idempotency-Key": "authoring-failed-sync-rejected",
            },
          },
        ),
      ).rejects.toMatchObject({
        response: { status: 409 },
      });

      await setAuthoring(productId, { state: "ready" });
      await expect(promote(productId)).rejects.toMatchObject({
        response: { status: 400, data: { code: "authoring_sync_unresolved" } },
      });

      mockCatalogBatch(authoringBatch());
      await api.post(
        "/admin/odoo/catalog-imports",
        {},
        {
          headers: {
            ...operator.headers,
            "Idempotency-Key": "authoring-failed-sync-resolved",
          },
        },
      );

      await expect(promote(productId)).resolves.toMatchObject({ status: 200 });
      expect(await getProductStatus(getContainer(), productId)).toEqual("published");
    });

    it("targets a failed changed-key resync by the stable Odoo template ID", async () => {
      const productId = await importProbe("authoring-changed-key-initial");
      const productService = getContainer().resolve<any>(Modules.PRODUCT);
      await productService.updateProducts(productId, {
        title: "Changed Key Product",
        description: "A failed identity change must take this Product offline.",
        images: [{ url: "https://assets.mze.store/ground/changed-key.jpg" }],
      });
      await setAuthoring(productId, { state: "ready" });
      await promote(productId);

      mockCatalogBatch(
        authoringBatch({
          templateIntegrationKey: "00000000-0000-4000-8000-000000000501",
        }),
      );
      await expect(
        api.post(
          "/admin/odoo/catalog-imports",
          {},
          {
            headers: {
              ...operator.headers,
              "Idempotency-Key": "authoring-changed-key-rejected",
            },
          },
        ),
      ).rejects.toMatchObject({
        response: { status: 409 },
      });

      const catalogSync = getContainer().resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
      await expect(
        catalogSync.listSyncRecords({
          operation_id: "catalog-import--authoring-changed-key-rejected",
        }),
      ).resolves.toEqual([
        expect.objectContaining({
          state: "failed",
          medusa_product_id: productId,
        }),
      ]);
      expect(await getProductStatus(getContainer(), productId)).toEqual("draft");
      await expect(promote(productId)).rejects.toMatchObject({
        response: { status: 400, data: { code: "authoring_sync_unresolved" } },
      });

      mockCatalogBatch(authoringBatch());
      await api.post(
        "/admin/odoo/catalog-imports",
        {},
        {
          headers: {
            ...operator.headers,
            "Idempotency-Key": "authoring-changed-key-resolved",
          },
        },
      );
      expect(await getProductStatus(getContainer(), productId)).toEqual("published");

      await expect(
        api.post(
          "/admin/odoo/catalog-imports",
          {},
          {
            headers: {
              ...operator.headers,
              "Idempotency-Key": "authoring-changed-key-rejected",
            },
          },
        ),
      ).rejects.toMatchObject({ response: { status: 409 } });
      expect(await getProductStatus(getContainer(), productId)).toEqual("published");
    });

    it("rejects promotion while required editorial fields or media are missing", async () => {
      const productId = await importProbe("authoring-gates");
      await setAuthoring(productId, { state: "ready" });
      const productService = getContainer().resolve<any>(Modules.PRODUCT);

      await productService.updateProducts(productId, { description: "   " });
      await expect(promote(productId)).rejects.toMatchObject({
        response: { status: 400, data: { code: "authoring_editorial_incomplete" } },
      });

      await productService.updateProducts(productId, {
        description: "Now described, still without Ground assets.",
      });
      await expect(promote(productId)).rejects.toMatchObject({
        response: { status: 400, data: { code: "authoring_media_missing" } },
      });
    });

    it("takes a published Product offline while Odoo archives it and restores it after reactivation", async () => {
      const productId = await importProbe("authoring-archive-cycle");
      const productService = getContainer().resolve<any>(Modules.PRODUCT);
      await productService.updateProducts(productId, {
        title: "Archive Cycle Product",
        description: "Editorial draft survives archival.",
        images: [{ url: "https://assets.mze.store/ground/cycle.jpg" }],
      });
      await setAuthoring(productId, { state: "ready" });
      await promote(productId);
      expect(await getProductStatus(getContainer(), productId)).toEqual("published");

      mockCatalogBatch(authoringBatch({ active: false }));
      const archived = await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "authoring-archive-offline" } },
      );
      expect(archived.data.catalog_import.disposition).toEqual("updated");

      expect(await getProductStatus(getContainer(), productId)).toEqual("draft");

      const authoring =
        getContainer().resolve<ProductAuthoringModuleService>(PRODUCT_AUTHORING_MODULE);
      const record = await authoring.getAuthoring(productId);
      expect(record?.state).toEqual("published");

      const product = await productService.retrieveProduct(productId);
      expect(product.description).toEqual("Editorial draft survives archival.");

      mockCatalogBatch(authoringBatch({ active: true }));
      await api.post(
        "/admin/odoo/catalog-imports",
        {},
        { headers: { ...operator.headers, "Idempotency-Key": "authoring-archive-online" } },
      );

      expect(await getProductStatus(getContainer(), productId)).toEqual("published");
    });

    it("takes a Product offline when no Odoo Variant remains saleable", async () => {
      const productId = await importProbe("authoring-variant-archive-initial");
      const productService = getContainer().resolve<any>(Modules.PRODUCT);
      await productService.updateProducts(productId, {
        title: "Variant Archive Product",
        description: "The Product needs at least one saleable Variant.",
        images: [{ url: "https://assets.mze.store/ground/variant-archive.jpg" }],
      });
      await setAuthoring(productId, { state: "ready" });
      await promote(productId);
      expect(await getProductStatus(getContainer(), productId)).toEqual("published");

      mockCatalogBatch(authoringBatch({ variantActive: false }));
      await api.post(
        "/admin/odoo/catalog-imports",
        {},
        {
          headers: {
            ...operator.headers,
            "Idempotency-Key": "authoring-variant-archive-offline",
          },
        },
      );

      expect(await getProductStatus(getContainer(), productId)).toEqual("draft");
      const authoring =
        getContainer().resolve<ProductAuthoringModuleService>(PRODUCT_AUTHORING_MODULE);
      await expect(authoring.getAuthoring(productId)).resolves.toMatchObject({
        state: "published",
      });
      await expect(promote(productId)).rejects.toMatchObject({
        response: { status: 400, data: { code: "authoring_source_unavailable" } },
      });
      expect(await getProductStatus(getContainer(), productId)).toEqual("draft");
    });

    it("does not target an existing Product for a colliding incoming Integration Key", async () => {
      const productId = await importProbe("authoring-collision-initial");
      const productService = getContainer().resolve<any>(Modules.PRODUCT);
      await productService.updateProducts(productId, {
        title: "Collision Target Product",
        description: "A foreign identity collision must not demote this Product.",
        images: [{ url: "https://assets.mze.store/ground/collision.jpg" }],
      });
      await setAuthoring(productId, { state: "ready" });
      await promote(productId);

      const collision = authoringBatch();
      const item = collision.items[0];
      mockCatalogBatch({
        ...collision,
        items: [
          {
            ...item,
            source_revision: { ...item.source_revision, id: 1501 },
            template: { ...item.template, id: 1501 },
            variants: [
              {
                ...item.variants[0],
                id: 1601,
                integration_key: "00000000-0000-4000-8000-000000001601",
              },
            ],
          },
        ],
        next_cursor: { ...collision.next_cursor, id: 1501 },
      });
      await expect(
        api.post(
          "/admin/odoo/catalog-imports",
          {},
          {
            headers: {
              ...operator.headers,
              "Idempotency-Key": "authoring-collision-rejected",
            },
          },
        ),
      ).rejects.toMatchObject({ response: { status: 409 } });

      const catalogSync = getContainer().resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
      await expect(
        catalogSync.listSyncRecords({
          operation_id: "catalog-import--authoring-collision-rejected",
        }),
      ).resolves.toEqual([expect.objectContaining({ state: "failed", medusa_product_id: null })]);
      expect(await getProductStatus(getContainer(), productId)).toEqual("published");
    });
  },
});
