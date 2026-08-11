export const TAX_RATE_AUDIT_MODULE = "tax_rate_audit" as const;

export const TAX_RATE_AUDIT_ACTIONS = ["created", "updated"] as const;
export const TAX_RATE_AUDIT_ACTOR_KINDS = ["operator", "system"] as const;
export const TAX_RATE_AUDIT_RESOURCE_KINDS = ["tax_rate", "tax_region"] as const;

export type TaxRateAuditAction = (typeof TAX_RATE_AUDIT_ACTIONS)[number];
export type TaxRateAuditResourceKind = (typeof TAX_RATE_AUDIT_RESOURCE_KINDS)[number];

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
  requestFingerprint: string;
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

export type TaxRateAuditOperationInput = {
  operationId: string;
  requestFingerprint: string;
  resourceKind: TaxRateAuditResourceKind;
  resourceId: string;
};

export type TaxRateChangeQuery = {
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
