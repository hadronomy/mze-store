import { defineMiddlewares, validateAndTransformQuery } from "@medusajs/framework/http";
import { TaxRateChangeListQuerySchema } from "~/modules/tax-rate-audit/schema";

export default defineMiddlewares({
  routes: [
    {
      matcher: "/admin/tax-rate-changes",
      methods: ["GET"],
      middlewares: [validateAndTransformQuery(TaxRateChangeListQuerySchema, {})],
    },
  ],
});
