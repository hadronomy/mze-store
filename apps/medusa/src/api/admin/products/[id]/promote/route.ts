import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { promoteAuthoringWorkflow } from "~/workflows/authoring-promote";

export async function POST(req: AuthenticatedMedusaRequest, res: MedusaResponse): Promise<void> {
  const productId = req.params.id;
  if (!productId) {
    res.status(400).json({ message: "The request must identify a Product." });
    return;
  }

  const { result } = await promoteAuthoringWorkflow(req.scope).run({ input: { productId } });

  res.status(200).json({
    product: {
      id: result.id,
      status: result.status,
    },
  });
}
