import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { TAX_RATE_AUDIT_MODULE } from "~/modules/tax-rate-audit";
import type {
  TaxRateChangeResponse,
  TaxRateChangeListQuery,
  TaxRateChangesResponse,
} from "~/modules/tax-rate-audit/schema";
import type { TaxRateAuditModule, TaxRateChangeRecord } from "~/modules/tax-rate-audit/service";

export async function GET(
  req: AuthenticatedMedusaRequest<never, TaxRateChangeListQuery>,
  res: MedusaResponse<TaxRateChangesResponse>,
): Promise<void> {
  const query = req.validatedQuery;
  const auditService = req.scope.resolve<TaxRateAuditModule>(TAX_RATE_AUDIT_MODULE);
  const result = await auditService.listChanges({
    taxRateId: query.tax_rate_id,
    taxRegionId: query.tax_region_id,
    provinceCode: query.province_code,
    actorId: query.actor_id,
    action: query.action,
    occurredFrom: query.from,
    occurredTo: query.to,
    limit: query.limit,
    offset: query.offset,
  });

  res.status(200).json({
    tax_rate_changes: toResponse(result.changes),
    count: result.count,
    limit: result.limit,
    offset: result.offset,
  });
}

function toResponse(changes: TaxRateChangeRecord[]): TaxRateChangeResponse[] {
  const response: TaxRateChangeResponse[] = [];

  for (const change of changes) {
    response.push({
      id: change.id,
      action: change.action,
      tax_rate_id: change.tax_rate_id,
      tax_region_id: change.tax_region_id,
      country_code: change.country_code,
      province_code: change.province_code,
      tax_rate_name: change.tax_rate_name,
      tax_rate_code: change.tax_rate_code,
      before_rate: change.before_rate,
      after_rate: change.after_rate,
      actor_kind: change.actor_kind,
      actor_id: change.actor_id,
      actor_email: change.actor_email,
      occurred_at: change.occurred_at.toISOString(),
    });
  }

  return response;
}
