import type { MedusaContainer } from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { linkProductsToSalesChannelWorkflow } from "@medusajs/medusa/core-flows";
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

type JsonInput =
  | boolean
  | null
  | number
  | string
  | readonly JsonInput[]
  | { readonly [key: string]: JsonInput | undefined };

type OdooResponse = { body: JsonInput; consumed: boolean };
type OdooScope = { isDone(): boolean };

function authoringBatch(options: { active?: boolean; renamed?: boolean } = {}) {
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
          integration_key: TEMPLATE_KEY,
          media: [],
          model: "product.template",
          name: templateName,
          sale_ok: true,
          taxes: [],
          write_date: "2026-08-19T09:00:00Z",
        },
        variants: [
          {
            active: true,
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
        seo_title?: string;
        colour?: string;
        merchandising_rank?: number;
      },
    ): Promise<void> {
      await api.put(`/admin/products/${productId}/authoring`, body, {
        headers: operator.headers,
      });
    }

    async function promote(productId: string): Promise<any> {
      return api.post(`/admin/products/${productId}/promote`, {}, { headers: operator.headers });
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

      const product = await productService.retrieveProduct(productId);
      expect(product.title).toEqual("Operator Title");
      expect(product.description).toEqual("Operator description that must survive.");

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
      const promoted = await promote(productId);
      expect(promoted.status).toEqual(200);

      expect(await getProductStatus(getContainer(), productId)).toEqual("published");

      const visible = await fetchStoreProduct(probe.publishableKey, productId);
      expect(visible).toMatchObject({ id: productId, status: "published" });

      const authoring =
        getContainer().resolve<ProductAuthoringModuleService>(PRODUCT_AUTHORING_MODULE);
      expect((await authoring.getAuthoring(productId))?.state).toEqual("published");
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
  },
});
