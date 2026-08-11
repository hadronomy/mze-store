import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { HttpTypes, UpdateTaxRateDTO } from "@medusajs/framework/types";
import {
  MedusaError,
  ContainerRegistrationKeys,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils";
import { deleteTaxRatesWorkflow } from "@medusajs/medusa/core-flows";
import {
  findTaxRateChange,
  operationIdFromRequest,
  refetchTaxRate,
} from "~/api/admin/tax-rate-audit";
import { updateAuditedTaxRateWorkflow } from "~/workflows/tax-rate-audit";

export const POST = async (
  req: AuthenticatedMedusaRequest<HttpTypes.AdminUpdateTaxRate, HttpTypes.SelectParams>,
  res: MedusaResponse<HttpTypes.AdminTaxRateResponse>,
) => {
  const id = req.params.id;
  if (!id) {
    throw new MedusaError(MedusaError.Types.INVALID_DATA, "Tax Rate ID is required.");
  }

  const existingTaxRate = await refetchTaxRate(id, req.scope, ["id"]);
  if (!existingTaxRate) {
    throw new MedusaError(MedusaError.Types.NOT_FOUND, `Tax rate with id "${id}" not found`);
  }

  const actorId = req.auth_context.actor_id;
  const operationId = operationIdFromRequest(req, `tax-rate:update:${id}`);
  const existingChange = await findTaxRateChange(operationId, req.scope);

  if (existingChange) {
    const body = req.validatedBody;
    if (
      existingChange.action !== "updated" ||
      existingChange.tax_rate_id !== id ||
      (body.rate !== undefined && existingChange.after_rate !== body.rate) ||
      (body.name !== undefined && existingChange.tax_rate_name !== body.name) ||
      (body.code !== undefined && existingChange.tax_rate_code !== body.code)
    ) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        `Idempotency key ${operationId} was already used for a different Tax Rate update.`,
      );
    }

    const taxRate = await refetchTaxRate(id, req.scope, req.queryConfig.fields);
    res.status(200).json({ tax_rate: taxRate });
    return;
  }

  await updateAuditedTaxRateWorkflow(req.scope).run({
    input: {
      id,
      data: req.validatedBody as UpdateTaxRateDTO,
      actor: { kind: "operator", id: actorId },
      operationId,
    },
    context: { transactionId: operationId },
  });

  const taxRate = await refetchTaxRate(id, req.scope, req.queryConfig.fields);
  res.status(200).json({ tax_rate: taxRate });
};

export const GET = async (
  req: AuthenticatedMedusaRequest<HttpTypes.AdminGetTaxRateParams>,
  res: MedusaResponse<HttpTypes.AdminTaxRateResponse>,
) => {
  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY);
  const [taxRate] = await remoteQuery(
    remoteQueryObjectFromString({
      entryPoint: "tax_rate",
      variables: { id: req.params.id },
      fields: req.queryConfig.fields,
    }),
  );

  res.status(200).json({ tax_rate: taxRate });
};

export const DELETE = async (
  req: AuthenticatedMedusaRequest<HttpTypes.AdminGetTaxRateParams>,
  res: MedusaResponse<HttpTypes.AdminTaxRateDeleteResponse>,
) => {
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
};
