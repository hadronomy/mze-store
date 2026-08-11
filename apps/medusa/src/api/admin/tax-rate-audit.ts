import type { MedusaContainer } from "@medusajs/framework/types";
import { ContainerRegistrationKeys, remoteQueryObjectFromString } from "@medusajs/framework/utils";
import { randomUUID } from "node:crypto";
import TaxRateAuditModuleService from "~/modules/tax-rate-audit/service";
import { TAX_RATE_AUDIT_MODULE } from "~/modules/tax-rate-audit";

export function operationIdFromRequest(
  request: { get(name: string): string | undefined },
  scope: string,
) {
  const key = (request.get("Idempotency-Key") ?? request.get("X-Idempotency-Key"))?.trim();
  return `${scope}:${key || randomUUID()}`;
}

export async function findTaxRateChange(operationId: string, scope: MedusaContainer) {
  const auditService = scope.resolve<TaxRateAuditModuleService>(TAX_RATE_AUDIT_MODULE);
  const change = await auditService.findByOperationId(operationId);

  return change as Record<string, unknown> | undefined;
}

export async function refetchTaxRate(id: string, scope: MedusaContainer, fields: string[]) {
  const remoteQuery = scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY);
  const [taxRate] = await remoteQuery(
    remoteQueryObjectFromString({
      entryPoint: "tax_rate",
      variables: { filters: { id } },
      fields,
    }),
  );

  return taxRate;
}

export async function refetchTaxRegion(id: string, scope: MedusaContainer, fields: string[]) {
  const remoteQuery = scope.resolve(ContainerRegistrationKeys.REMOTE_QUERY);
  const [taxRegion] = await remoteQuery(
    remoteQueryObjectFromString({
      entryPoint: "tax_region",
      variables: { filters: { id } },
      fields,
    }),
  );

  return taxRegion;
}
