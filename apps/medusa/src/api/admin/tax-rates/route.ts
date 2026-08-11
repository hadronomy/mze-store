import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { CreateTaxRateDTO, HttpTypes } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  MedusaError,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils";
import { createAuditedTaxRateWorkflow } from "~/workflows/tax-rate-audit";
import {
  findTaxRateChange,
  operationIdFromRequest,
  refetchTaxRate,
} from "~/api/admin/tax-rate-audit";

export const POST = async (
  req: AuthenticatedMedusaRequest<HttpTypes.AdminCreateTaxRate, HttpTypes.SelectParams>,
  res: MedusaResponse<HttpTypes.AdminTaxRateResponse>,
) => {
  const actorId = req.auth_context.actor_id;
  const operationId = operationIdFromRequest(req, "tax-rate:create");
  const existingChange = await findTaxRateChange(operationId, req.scope);

  if (existingChange) {
    const body = req.validatedBody;
    if (
      existingChange.action !== "created" ||
      existingChange.tax_region_id !== body.tax_region_id ||
      existingChange.tax_rate_name !== body.name ||
      existingChange.tax_rate_code !== body.code ||
      (body.rate !== undefined && existingChange.after_rate !== body.rate)
    ) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        `Idempotency key ${operationId} was already used for a different Tax Rate create.`,
      );
    }

    const taxRate = await refetchTaxRate(
      String(existingChange.tax_rate_id),
      req.scope,
      req.queryConfig.fields,
    );
    res.status(200).json({ tax_rate: taxRate });
    return;
  }

  const { result } = await createAuditedTaxRateWorkflow(req.scope).run({
    input: {
      data: {
        ...req.validatedBody,
        created_by: actorId,
      } as CreateTaxRateDTO,
      actor: { kind: "operator", id: actorId },
      operationId,
    },
    context: { transactionId: operationId },
  });

  const [created] = result;
  if (!created) {
    throw new Error("The Tax Rate create workflow returned no Tax Rate.");
  }

  const taxRate = await refetchTaxRate(created.id, req.scope, req.queryConfig.fields);
  res.status(200).json({ tax_rate: taxRate });
};

export const GET = async (
  req: AuthenticatedMedusaRequest<HttpTypes.AdminTaxRateListParams>,
  res: MedusaResponse<HttpTypes.AdminTaxRateListResponse>,
) => {
  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY);
  const { rows: tax_rates, metadata } = await remoteQuery(
    remoteQueryObjectFromString({
      entryPoint: "tax_rate",
      variables: {
        filters: req.filterableFields,
        ...req.queryConfig.pagination,
      },
      fields: req.queryConfig.fields,
    }),
  );

  res.status(200).json({
    tax_rates,
    count: metadata.count,
    offset: metadata.skip,
    limit: metadata.take,
  });
};
