import type { MedusaNextFunction, MedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { z } from "@medusajs/framework/zod";
import { authoringError } from "~/modules/product-authoring/errors";

const ProductStatusUpdateSchema = z.object({ status: z.string().optional() }).passthrough();
const ProductPublicationRequestSchema = ProductStatusUpdateSchema.extend({
  create: z.array(ProductStatusUpdateSchema).optional(),
  update: z.array(ProductStatusUpdateSchema).optional(),
});

export function requirePromotionWorkflow(
  req: MedusaRequest,
  _res: MedusaResponse,
  next: MedusaNextFunction,
): void {
  const body = ProductPublicationRequestSchema.safeParse(req.body);
  const mutations = body.success
    ? [body.data, ...(body.data.create ?? []), ...(body.data.update ?? [])]
    : [];
  if (mutations.some(({ status }) => status === "published")) {
    throw authoringError(
      "authoring_promotion_required",
      "Publish the Product through POST /admin/products/:id/promote.",
    );
  }

  next();
}
