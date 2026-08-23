import {
  defineMiddlewares,
  validateAndTransformBody,
  validateAndTransformQuery,
} from "@medusajs/framework/http";
import { CatalogImportRequestSchema } from "~/modules/catalog-sync/schema";
import { TaxRateChangeListQuerySchema } from "~/modules/tax-rate-audit/schema";
import { EditAuthoringRequestSchema } from "~/api/admin/products/[id]/authoring/schema";
import { requirePromotionWorkflow } from "~/api/admin/products/authoring-gate";
import {
  filterUnavailableCatalogVariants,
  requireAvailableCatalogVariant,
} from "~/api/store/catalog-availability";

export default defineMiddlewares({
  routes: [
    {
      matcher: "/admin/odoo/catalog-imports",
      methods: ["POST"],
      middlewares: [validateAndTransformBody(CatalogImportRequestSchema)],
    },
    {
      matcher: "/admin/products/:id/authoring",
      methods: ["PUT"],
      middlewares: [validateAndTransformBody(EditAuthoringRequestSchema)],
    },
    {
      matcher: "/admin/products",
      methods: ["POST"],
      middlewares: [requirePromotionWorkflow],
    },
    {
      matcher: "/admin/products/batch",
      methods: ["POST"],
      middlewares: [requirePromotionWorkflow],
    },
    {
      matcher: "/admin/products/:id",
      methods: ["POST"],
      middlewares: [requirePromotionWorkflow],
    },
    {
      matcher: "/store/products",
      methods: ["GET"],
      middlewares: [filterUnavailableCatalogVariants],
    },
    {
      matcher: "/store/products/:id",
      methods: ["GET"],
      middlewares: [filterUnavailableCatalogVariants],
    },
    {
      matcher: "/store/product-variants",
      methods: ["GET"],
      middlewares: [filterUnavailableCatalogVariants],
    },
    {
      matcher: "/store/product-variants/:id",
      methods: ["GET"],
      middlewares: [requireAvailableCatalogVariant],
    },
    {
      matcher: "/admin/tax-rate-changes",
      methods: ["GET"],
      middlewares: [validateAndTransformQuery(TaxRateChangeListQuerySchema, {})],
    },
  ],
});
