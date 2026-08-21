import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { HttpTypes, UpdateTaxRateDTO } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  MedusaError,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils";
import { deleteTaxRatesWorkflow } from "@medusajs/medusa/core-flows";
import { operationIdFromRequest } from "~/api/admin/idempotency";
import { refetchTaxRate } from "~/api/admin/tax-rate-audit";
import { updateTaxRateWithAudit } from "~/workflows/tax-rate-audit-operations";

export async function POST(
  req: AuthenticatedMedusaRequest<HttpTypes.AdminUpdateTaxRate, HttpTypes.SelectParams>,
  res: MedusaResponse<HttpTypes.AdminTaxRateResponse>,
): Promise<void> {
  const id = req.params.id;
  if (!id) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Tax Rate ID is required.");
  }

  const actorId = req.auth_context.actor_id;
  const operationId = operationIdFromRequest(req, `tax-rate:update:${id}`);
  const data: UpdateTaxRateDTO = req.validatedBody;

  await updateTaxRateWithAudit(req.scope, {
    id,
    data,
    actor: { kind: "operator", id: actorId },
    operationId,
  });

  const taxRate = await refetchTaxRate(id, req.scope, req.queryConfig.fields);
  res.status(200).json({ tax_rate: taxRate });
}

export async function GET(
  req: AuthenticatedMedusaRequest<HttpTypes.AdminGetTaxRateParams>,
  res: MedusaResponse<HttpTypes.AdminTaxRateResponse>,
): Promise<void> {
  const id = req.params.id;
  if (!id) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Tax Rate ID is required.");
  }

  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY);
  const [taxRate] = await remoteQuery(
    remoteQueryObjectFromString({
      entryPoint: "tax_rate",
      variables: { id },
      fields: req.queryConfig.fields,
    }),
  );

  res.status(200).json({ tax_rate: taxRate });
}

export async function DELETE(
  req: AuthenticatedMedusaRequest<HttpTypes.AdminGetTaxRateParams>,
  res: MedusaResponse<HttpTypes.AdminTaxRateDeleteResponse>,
): Promise<void> {
  const id = req.params.id;
  if (!id) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Tax Rate ID is required.");
  }

  await deleteTaxRatesWorkflow(req.scope).run({ input: { ids: [id] } });

  res.status(200).json({
    id,
    object: "tax_rate",
    deleted: true,
  });
}
