import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { editAuthoringWorkflow } from "~/workflows/authoring-edit";
import type { EditAuthoringRequest } from "./schema";

export async function PUT(
  req: AuthenticatedMedusaRequest<EditAuthoringRequest>,
  res: MedusaResponse,
): Promise<void> {
  const productId = req.params.id;
  if (!productId) {
    res.status(400).json({ message: "The request must identify a Product." });
    return;
  }

  const body = req.validatedBody;
  // Undefined means "not sent" and leaves the field untouched; null clears it.
  const { result } = await editAuthoringWorkflow(req.scope).run({
    input: {
      productId,
      state: body.state,
      blockedReason: body.blocked_reason,
      seoTitle: body.seo_title,
      seoDescription: body.seo_description,
      colour: body.colour,
      merchandisingRank: body.merchandising_rank,
    },
  });

  res.status(200).json({
    product_authoring: {
      id: result.productId,
      state: result.state,
      blocked_reason: result.blockedReason,
      seo_title: result.seoTitle,
      seo_description: result.seoDescription,
      colour: result.colour,
      merchandising_rank: result.merchandisingRank,
    },
  });
}
