export const TAX_RATE_AUDIT_MODULE = "tax_rate_audit" as const;

export type TaxRateAuditAction = "created" | "updated";

export type TaxRateAuditActor =
  | {
      kind: "operator";
      id: string;
    }
  | {
      kind: "system";
      id: string;
    };

export type TaxRateChangeInput = {
  operationId: string;
  action: TaxRateAuditAction;
  taxRateId: string;
  taxRegionId: string;
  countryCode: string;
  provinceCode: string | null;
  taxRateName: string;
  taxRateCode: string | null;
  beforeRate: number | null;
  afterRate: number | null;
  actor: TaxRateAuditActor;
  actorEmail: string | null;
  occurredAt: Date;
};

export type TaxRateChangeFilters = {
  taxRateId?: string;
  taxRegionId?: string;
  provinceCode?: string;
  actorId?: string;
  action?: TaxRateAuditAction;
  occurredFrom?: Date;
  occurredTo?: Date;
  limit: number;
  offset: number;
};
