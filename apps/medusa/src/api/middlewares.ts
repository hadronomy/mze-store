import {
  defineMiddlewares,
  validateAndTransformBody,
  validateAndTransformQuery,
} from "@medusajs/framework/http";
import { CatalogImportRequestSchema } from "~/modules/catalog-sync/schema";
import { TaxRateChangeListQuerySchema } from "~/modules/tax-rate-audit/schema";
import { EditAuthoringRequestSchema } from "~/api/admin/products/[id]/authoring/schema";

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
      matcher: "/admin/tax-rate-changes",
      methods: ["GET"],
      middlewares: [validateAndTransformQuery(TaxRateChangeListQuerySchema, {})],
    },
  ],
});
