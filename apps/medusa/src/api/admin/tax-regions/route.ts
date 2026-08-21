import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { CreateTaxRegionDTO, HttpTypes } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, remoteQueryObjectFromString } from "@medusajs/framework/utils";
import { operationIdFromRequest } from "~/api/admin/idempotency";
import { refetchTaxRegion } from "~/api/admin/tax-rate-audit";
import { createTaxRegionWithAudit } from "~/workflows/tax-rate-audit-operations";

export async function POST(
  req: AuthenticatedMedusaRequest<HttpTypes.AdminCreateTaxRegion, HttpTypes.AdminTaxRegionParams>,
  res: MedusaResponse<HttpTypes.AdminTaxRegionResponse>,
): Promise<void> {
  const actorId = req.auth_context.actor_id;
  const operationId = operationIdFromRequest(req, "tax-region:create");
  const data: CreateTaxRegionDTO = {
    ...req.validatedBody,
    created_by: actorId,
  };

  const created = await createTaxRegionWithAudit(req.scope, {
    data,
    actor: { kind: "operator", id: actorId },
    operationId,
  });

  const taxRegion = await refetchTaxRegion(created.id, req.scope, req.queryConfig.fields);
  res.status(200).json({ tax_region: taxRegion });
}

export async function GET(
  req: AuthenticatedMedusaRequest<HttpTypes.AdminTaxRegionListParams>,
  res: MedusaResponse<HttpTypes.AdminTaxRegionListResponse>,
): Promise<void> {
  const remoteQuery = req.scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY);
  const { rows: tax_regions, metadata } = await remoteQuery(
    remoteQueryObjectFromString({
      entryPoint: "tax_regions",
      variables: {
        filters: req.filterableFields,
        ...req.queryConfig.pagination,
      },
      fields: req.queryConfig.fields,
    }),
  );

  res.status(200).json({
    tax_regions,
    count: metadata.count,
    offset: metadata.skip,
    limit: metadata.take,
  });
}
