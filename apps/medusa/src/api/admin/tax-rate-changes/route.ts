import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http";
import { MedusaError } from "@medusajs/framework/utils";
import TaxRateAuditModuleService from "~/modules/tax-rate-audit/service";
import { TAX_RATE_AUDIT_MODULE, type TaxRateAuditAction } from "~/modules/tax-rate-audit";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export async function GET(req: AuthenticatedMedusaRequest, res: MedusaResponse) {
  const query = req.query as Record<string, unknown>;
  const action = parseAction(queryValue(query.action));

  const limit = parseInteger(queryValue(query.limit), DEFAULT_LIMIT, "limit");
  if (limit < 1 || limit > MAX_LIMIT) {
    throw invalidQuery(`limit must be between 1 and ${MAX_LIMIT}`);
  }

  const offset = parseInteger(queryValue(query.offset), 0, "offset");
  if (offset < 0) {
    throw invalidQuery("offset must be zero or greater");
  }

  const occurredFrom = parseDate(queryValue(query.from), "from");
  const occurredTo = parseDate(queryValue(query.to), "to");
  if (occurredFrom && occurredTo && occurredFrom > occurredTo) {
    throw invalidQuery("from must be before to");
  }

  const auditService = req.scope.resolve<TaxRateAuditModuleService>(TAX_RATE_AUDIT_MODULE);
  const result = await auditService.listChanges({
    taxRateId: queryValue(query.tax_rate_id),
    taxRegionId: queryValue(query.tax_region_id),
    provinceCode: queryValue(query.province_code),
    actorId: queryValue(query.actor_id),
    action,
    occurredFrom,
    occurredTo,
    limit,
    offset,
  });

  res.status(200).json({
    tax_rate_changes: result.changes,
    count: result.count,
    limit: result.limit,
    offset: result.offset,
  });
}

function queryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return typeof value[0] === "string" ? value[0] : undefined;
  }

  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw invalidQuery(`${name} must be an integer`);
  }

  return parsed;
}

function parseDate(value: string | undefined, name: string): Date | undefined {
  if (value === undefined) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    throw invalidQuery(`${name} must be an ISO date`);
  }

  if (name === "to" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    parsed.setUTCHours(23, 59, 59, 999);
  }

  return parsed;
}

function parseAction(value: string | undefined): TaxRateAuditAction | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value !== "created" && value !== "updated") {
    throw invalidQuery("action must be created or updated");
  }

  return value;
}

function invalidQuery(message: string): MedusaError {
  return new MedusaError(MedusaError.Types.INVALID_DATA, message);
}
