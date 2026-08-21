import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { CreateTaxRateDTO, HttpTypes } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, remoteQueryObjectFromString } from "@medusajs/framework/utils";
import { createTaxRateWithAudit } from "~/workflows/tax-rate-audit-operations";
import { operationIdFromRequest } from "~/api/admin/idempotency";
import { refetchTaxRate } from "~/api/admin/tax-rate-audit";

export async function POST(
  req: AuthenticatedMedusaRequest<HttpTypes.AdminCreateTaxRate, HttpTypes.SelectParams>,
  res: MedusaResponse<HttpTypes.AdminTaxRateResponse>,
): Promise<void> {
  const actorId = req.auth_context.actor_id;
  const operationId = operationIdFromRequest(req, "tax-rate:create");
  const data: CreateTaxRateDTO = {
    ...req.validatedBody,
    created_by: actorId,
  };

  const created = await createTaxRateWithAudit(req.scope, {
    data,
    actor: { kind: "operator", id: actorId },
    operationId,
  });

  const taxRate = await refetchTaxRate(created.id, req.scope, req.queryConfig.fields);
  res.status(200).json({ tax_rate: taxRate });
}

export async function GET(
  req: AuthenticatedMedusaRequest<HttpTypes.AdminTaxRateListParams>,
  res: MedusaResponse<HttpTypes.AdminTaxRateListResponse>,
): Promise<void> {
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
}
