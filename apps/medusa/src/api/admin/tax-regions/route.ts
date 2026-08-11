import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import type { CreateTaxRegionDTO, HttpTypes } from "@medusajs/framework/types";
import {
  ContainerRegistrationKeys,
  MedusaError,
  remoteQueryObjectFromString,
} from "@medusajs/framework/utils";
import {
  findTaxRateChange,
  operationIdFromRequest,
  refetchTaxRegion,
} from "~/api/admin/tax-rate-audit";
import { createAuditedTaxRegionsWorkflow } from "~/workflows/tax-rate-audit";

export const POST = async (
  req: AuthenticatedMedusaRequest<HttpTypes.AdminCreateTaxRegion, HttpTypes.AdminTaxRegionParams>,
  res: MedusaResponse<HttpTypes.AdminTaxRegionResponse>,
) => {
  const actorId = req.auth_context.actor_id;
  const operationId = operationIdFromRequest(req, "tax-region:create");
  const existingChange = await findTaxRateChange(operationId, req.scope);

  if (existingChange) {
    const body = req.validatedBody;
    const defaultRate = body.default_tax_rate;
    if (
      existingChange.action !== "created" ||
      existingChange.country_code !== body.country_code ||
      existingChange.province_code !== (body.province_code ?? null) ||
      (defaultRate?.name !== undefined && existingChange.tax_rate_name !== defaultRate.name) ||
      (defaultRate?.code !== undefined && existingChange.tax_rate_code !== defaultRate.code) ||
      (defaultRate?.rate !== undefined && existingChange.after_rate !== defaultRate.rate)
    ) {
      throw new MedusaError(
        MedusaError.Types.CONFLICT,
        `Idempotency key ${operationId} was already used for a different Tax Region create.`,
      );
    }

    const taxRegion = await refetchTaxRegion(
      String(existingChange.tax_region_id),
      req.scope,
      req.queryConfig.fields,
    );
    res.status(200).json({ tax_region: taxRegion });
    return;
  }

  const { result } = await createAuditedTaxRegionsWorkflow(req.scope).run({
    input: {
      data: [
        {
          ...req.validatedBody,
          created_by: actorId,
        } as CreateTaxRegionDTO,
      ],
      actor: { kind: "operator", id: actorId },
      operationId,
    },
    context: { transactionId: operationId },
  });

  const [created] = result;
  if (!created) {
    throw new Error("The Tax Region create workflow returned no Tax Region.");
  }

  const taxRegion = await refetchTaxRegion(created.id, req.scope, req.queryConfig.fields);
  res.status(200).json({ tax_region: taxRegion });
};

export const GET = async (
  req: AuthenticatedMedusaRequest<HttpTypes.AdminTaxRegionListParams>,
  res: MedusaResponse<HttpTypes.AdminTaxRegionListResponse>,
) => {
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
};
