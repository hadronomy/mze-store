import type { ConfigModule, IProductModuleService } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, Modules, ProductStatus } from "@medusajs/framework/utils";
import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import { AuthenticationFailed, Result } from "@mze-store/odoo-bridge";
import type { CatalogBatchEncoded } from "@mze-store/odoo-bridge/contract";
import { synchronizeCatalogItemWorkflow } from "~/catalog/synchronize-catalog-item";
import { CATALOG_SYNC_MODULE, catalogError, type CatalogSyncModule } from "~/modules/catalog-sync";
import CatalogSyncModuleService from "~/modules/catalog-sync/service";
import {
  PRODUCT_AUTHORING_MODULE,
  type ProductAuthoringModuleService,
} from "~/modules/product-authoring";
import { FakeOdooBridgeGateway } from "./utils/fake-odoo-gateway";

jest.setTimeout(120 * 1000);

const TEMPLATE_INTEGRATION_KEY = "00000000-0000-4000-8000-000000000701";
const VARIANT_INTEGRATION_KEY = "00000000-0000-4000-8000-000000000702";
const fakeGateway = new FakeOdooBridgeGateway();

const catalogBatch = {
  contract_version: "mze.odoo.catalog.v1",
  items: [
    {
      source_revision: { id: 701, write_date: "2026-08-22T09:00:00Z" },
      template: {
        active: true,
        attributes: [],
        description: "A workflow boundary fixture.",
        id: 701,
        integration_key: TEMPLATE_INTEGRATION_KEY,
        media: [],
        model: "product.template",
        name: "WORKFLOW BOUNDARY PRODUCT",
        sale_ok: true,
        taxes: [],
        write_date: "2026-08-22T08:00:00Z",
      },
      variants: [
        {
          active: true,
          attribute_values: [],
          barcode: "8412345670702",
          default_code: "WORKFLOW-702",
          id: 702,
          integration_key: VARIANT_INTEGRATION_KEY,
          media: [],
          model: "product.product",
          name: "WORKFLOW BOUNDARY PRODUCT",
          price: "12.50",
          price_rule_id: null,
          sale_ok: true,
          write_date: "2026-08-22T08:00:00Z",
        },
      ],
    },
  ],
  next_cursor: { id: 701, write_date: "2026-08-22T09:00:00Z" },
  price_list: { currency: "EUR", id: 1, name: "Public Pricelist" },
  priced_at: "2026-08-22T09:05:00Z",
} as const satisfies CatalogBatchEncoded;

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  hooks: {
    beforeServerStart: async (container) => {
      const config = container.resolve<ConfigModule>(ContainerRegistrationKeys.CONFIG_MODULE);
      const catalogModule = config.modules?.[CATALOG_SYNC_MODULE];
      if (!catalogModule || catalogModule === true || catalogModule === false) {
        throw new Error("The Catalog Sync module is not registered for the integration test.");
      }
      catalogModule.options = { gateway: fakeGateway };
    },
  },
  testSuite: function catalogSynchronizationWorkflowTestSuite({ getContainer }) {
    beforeEach(() => {
      fakeGateway.reset();
    });

    afterEach(() => {
      fakeGateway.assertDrained();
    });

    it("synchronizes through the public workflow and replays without another Odoo call", async () => {
      fakeGateway.enqueueBatch(catalogBatch);
      const operationId = "catalog-workflow--success";
      const first = await synchronizeCatalogItemWorkflow(getContainer()).run({
        input: { operationId },
        context: { transactionId: operationId },
      });
      const replay = await synchronizeCatalogItemWorkflow(getContainer()).run({
        input: { operationId },
        context: { transactionId: `${operationId}-replay` },
      });

      const catalogSync = getContainer().resolve<CatalogSyncModule>(CATALOG_SYNC_MODULE);
      const productModule = getContainer().resolve<IProductModuleService>(Modules.PRODUCT);
      const authoring =
        getContainer().resolve<ProductAuthoringModuleService>(PRODUCT_AUTHORING_MODULE);
      const product = await productModule.retrieveProduct(first.result.productId);

      expect(first.result).toMatchObject({
        disposition: "created",
        templateIntegrationKey: TEMPLATE_INTEGRATION_KEY,
        variants: [
          {
            integrationKey: VARIANT_INTEGRATION_KEY,
            odooVariantId: 702,
            sourceAvailable: true,
            approvalState: "pending",
          },
        ],
      });
      expect(replay.result).toMatchObject({
        ...first.result,
        disposition: "replayed",
      });
      expect(fakeGateway.calls).toEqual([{ cursor: null, limit: 1, signal: undefined }]);
      await expect(catalogSync.getCatalogProjectionStatus(product.id)).resolves.toEqual({
        mapped: true,
        sourceAvailable: true,
        syncResolved: true,
      });
      await expect(catalogSync.getVariantAvailability(product.id)).resolves.toEqual([
        expect.objectContaining({
          sourceAvailable: true,
          approvalState: "pending",
          storefrontAvailable: false,
        }),
      ]);
      await expect(authoring.getAuthoring(product.id)).resolves.toMatchObject({
        state: "imported",
      });
      expect(product.status).toEqual("draft");
    });

    it("serializes concurrent runs that use the same operation ID", async () => {
      fakeGateway.enqueueBatch(catalogBatch);
      const operationId = "catalog-workflow--concurrent-operation";
      const readCatalogBatch = fakeGateway.readCatalogBatch.bind(fakeGateway);
      let readEntries = 0;
      let markReadStarted!: () => void;
      let releaseRead!: () => void;
      const readStarted = new Promise<void>((resolve) => {
        markReadStarted = resolve;
      });
      const readRelease = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      fakeGateway.readCatalogBatch = async (options) => {
        readEntries += 1;
        markReadStarted();
        await readRelease;
        return readCatalogBatch(options);
      };

      try {
        const first = synchronizeCatalogItemWorkflow(getContainer()).run({
          input: { operationId },
          context: { transactionId: `${operationId}-first` },
        });
        await readStarted;
        const second = synchronizeCatalogItemWorkflow(getContainer()).run({
          input: { operationId },
          context: { transactionId: `${operationId}-second` },
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(readEntries).toEqual(1);
        releaseRead();

        await expect(Promise.all([first, second])).resolves.toEqual([
          expect.objectContaining({ result: expect.objectContaining({ disposition: "created" }) }),
          expect.objectContaining({ result: expect.objectContaining({ disposition: "replayed" }) }),
        ]);
      } finally {
        releaseRead();
        fakeGateway.readCatalogBatch = readCatalogBatch;
      }
    });

    it("preserves the structured Odoo failure across an idempotent retry", async () => {
      fakeGateway.enqueueResult(Result.fail(new AuthenticationFailed({ status: 401 })));
      const operationId = "catalog-workflow--authentication-failure";
      const run = () =>
        synchronizeCatalogItemWorkflow(getContainer()).run({
          input: { operationId },
          context: { transactionId: `${operationId}-${fakeGateway.calls.length}` },
        });

      await expect(run()).rejects.toMatchObject({
        code: "catalog_source_authentication_failed",
        message: "[AuthenticationFailed] Odoo rejected the Service User API key.",
      });
      await expect(run()).rejects.toMatchObject({
        code: "catalog_source_authentication_failed",
        message: "[AuthenticationFailed] Odoo rejected the Service User API key.",
      });
      expect(fakeGateway.calls).toHaveLength(1);
    });

    it("compensates local writes when durable completion fails", async () => {
      fakeGateway.enqueueBatch(catalogBatch);
      const operationId = "catalog-workflow--resume-after-commit";
      const catalogSync = getContainer().resolve<CatalogSyncModuleService>(CATALOG_SYNC_MODULE);
      const authoring =
        getContainer().resolve<ProductAuthoringModuleService>(PRODUCT_AUTHORING_MODULE);
      const authoringBefore = await authoring.listProductAuthorings({});
      const finishSync = catalogSync.finishSync.bind(catalogSync);
      catalogSync.finishSync = async () => {
        throw new Error("The Sync Record store is temporarily unavailable.");
      };

      let interrupted: Awaited<
        ReturnType<ReturnType<typeof synchronizeCatalogItemWorkflow>["run"]>
      >;
      try {
        interrupted = await synchronizeCatalogItemWorkflow(getContainer()).run({
          input: { operationId },
          context: { transactionId: `${operationId}-interrupted` },
          throwOnError: false,
        });

        expect(interrupted.errors).toEqual([
          expect.objectContaining({
            error: expect.objectContaining({
              message: "The Sync Record store is temporarily unavailable.",
            }),
          }),
        ]);
      } finally {
        catalogSync.finishSync = finishSync;
      }

      const records = await catalogSync.listSyncRecords({ operation_id: operationId });
      expect(records).toEqual([
        expect.objectContaining({
          state: "failed",
          error_code: "catalog_import_failed",
        }),
      ]);
      await expect(authoring.listProductAuthorings({})).resolves.toHaveLength(
        authoringBefore.length,
      );
      if (interrupted.result?.productId) {
        const productModule = getContainer().resolve<IProductModuleService>(Modules.PRODUCT);
        await expect(
          productModule.listProducts({ id: interrupted.result.productId }),
        ).resolves.toEqual([]);
      }
      await expect(
        synchronizeCatalogItemWorkflow(getContainer()).run({
          input: { operationId },
          context: { transactionId: `${operationId}-retry` },
        }),
      ).rejects.toMatchObject({ code: "catalog_import_failed" });
      expect(fakeGateway.calls).toHaveLength(1);
    });

    it("fails durably and compensates when availability projection fails", async () => {
      fakeGateway.enqueueBatch(catalogBatch);
      const operationId = "catalog-workflow--availability-failure";
      const catalogSync = getContainer().resolve<CatalogSyncModuleService>(CATALOG_SYNC_MODULE);
      const projectAvailability = catalogSync.projectAvailability.bind(catalogSync);
      catalogSync.projectAvailability = async () => {
        throw catalogError(
          "catalog_structure_conflict",
          "The availability projection rejected the Catalog structure.",
        );
      };

      let interrupted: Awaited<
        ReturnType<ReturnType<typeof synchronizeCatalogItemWorkflow>["run"]>
      >;
      try {
        interrupted = await synchronizeCatalogItemWorkflow(getContainer()).run({
          input: { operationId },
          context: { transactionId: operationId },
          throwOnError: false,
        });
        expect(interrupted.errors).toEqual([
          expect.objectContaining({
            error: expect.objectContaining({
              message: "The availability projection rejected the Catalog structure.",
              code: "catalog_structure_conflict",
            }),
          }),
        ]);
      } finally {
        catalogSync.projectAvailability = projectAvailability;
      }

      await expect(catalogSync.listSyncRecords({ operation_id: operationId })).resolves.toEqual([
        expect.objectContaining({
          state: "failed",
          error_code: "catalog_structure_conflict",
        }),
      ]);
      if (interrupted!.result?.productId) {
        const productModule = getContainer().resolve<IProductModuleService>(Modules.PRODUCT);
        await expect(
          productModule.listProducts({ id: interrupted!.result.productId }),
        ).resolves.toEqual([]);
      }

      await expect(
        synchronizeCatalogItemWorkflow(getContainer()).run({
          input: { operationId },
          context: { transactionId: `${operationId}-replay` },
        }),
      ).rejects.toMatchObject({
        code: "catalog_structure_conflict",
        message: "The availability projection rejected the Catalog structure.",
      });
    });

    it("repairs a failed projection when the failed operation is replayed", async () => {
      fakeGateway.enqueueBatch(catalogBatch);
      const initialOperationId = "catalog-workflow--repair-initial";
      const initial = await synchronizeCatalogItemWorkflow(getContainer()).run({
        input: { operationId: initialOperationId },
        context: { transactionId: initialOperationId },
      });
      const catalogSync = getContainer().resolve<CatalogSyncModuleService>(CATALOG_SYNC_MODULE);
      const productModule = getContainer().resolve<IProductModuleService>(Modules.PRODUCT);
      const authoring =
        getContainer().resolve<ProductAuthoringModuleService>(PRODUCT_AUTHORING_MODULE);
      await authoring.editAuthoring({ productId: initial.result.productId, state: "ready" });
      await authoring.markPublished(initial.result.productId);
      await catalogSync.approveVariants(initial.result.productId);
      await catalogSync.projectAvailability(initial.result.productId, true);
      await productModule.updateProducts(initial.result.productId, {
        status: ProductStatus.PUBLISHED,
      });

      fakeGateway.enqueueBatch({
        ...catalogBatch,
        items: [
          {
            ...catalogBatch.items[0],
            variants: [{ ...catalogBatch.items[0].variants[0], price: "13.00" }],
          },
        ],
      });
      const operationId = "catalog-workflow--repair-failed-projection";
      const finishSync = catalogSync.finishSync.bind(catalogSync);
      const projectAvailability = catalogSync.projectAvailability.bind(catalogSync);
      catalogSync.finishSync = async () => {
        throw new Error("The Sync Record store is temporarily unavailable.");
      };
      catalogSync.projectAvailability = async (productId, published, options) => {
        if (!published) {
          throw new Error("The failure projection is temporarily unavailable.");
        }
        return projectAvailability(productId, published, options);
      };

      try {
        await synchronizeCatalogItemWorkflow(getContainer()).run({
          input: { operationId },
          context: { transactionId: operationId },
          throwOnError: false,
        });
      } finally {
        catalogSync.finishSync = finishSync;
        catalogSync.projectAvailability = projectAvailability;
      }

      await expect(productModule.retrieveProduct(initial.result.productId)).resolves.toMatchObject({
        status: ProductStatus.PUBLISHED,
      });
      await expect(
        synchronizeCatalogItemWorkflow(getContainer()).run({
          input: { operationId },
          context: { transactionId: `${operationId}-replay` },
        }),
      ).rejects.toMatchObject({ code: "catalog_import_failed" });
      await expect(productModule.retrieveProduct(initial.result.productId)).resolves.toMatchObject({
        status: ProductStatus.DRAFT,
      });
      await expect(catalogSync.getVariantAvailability(initial.result.productId)).resolves.toEqual([
        expect.objectContaining({ storefrontAvailable: false }),
      ]);
    });

    it("replays a completed operation without reprojecting availability", async () => {
      fakeGateway.enqueueBatch(catalogBatch);
      const operationId = "catalog-workflow--side-effect-free-replay";
      const catalogSync = getContainer().resolve<CatalogSyncModuleService>(CATALOG_SYNC_MODULE);
      const first = await synchronizeCatalogItemWorkflow(getContainer()).run({
        input: { operationId },
        context: { transactionId: operationId },
      });
      const projectAvailability = catalogSync.projectAvailability.bind(catalogSync);
      catalogSync.projectAvailability = async () => {
        throw new Error("A replay must not project availability.");
      };

      try {
        await expect(
          synchronizeCatalogItemWorkflow(getContainer()).run({
            input: { operationId },
            context: { transactionId: `${operationId}-replay` },
          }),
        ).resolves.toMatchObject({
          result: { ...first.result, disposition: "replayed" },
        });
      } finally {
        catalogSync.projectAvailability = projectAvailability;
      }
      expect(fakeGateway.calls).toHaveLength(1);
    });
  },
});
