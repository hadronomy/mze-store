import type {
  ILockingModule,
  ITaxModuleService,
  MedusaContainer,
  TaxRateDTO,
  TaxRegionDTO,
} from "@medusajs/framework/types";
import { MedusaError, Modules } from "@medusajs/framework/utils";
import stringify from "fast-json-stable-stringify";
import { createHash } from "node:crypto";
import { TAX_RATE_AUDIT_MODULE } from "~/modules/tax-rate-audit";
import type {
  TaxRateAuditModule,
  TaxRateAuditOperationRecord,
} from "~/modules/tax-rate-audit/service";
import {
  type AuditedCreateTaxRateInput,
  type AuditedCreateTaxRegionInput,
  type AuditedUpdateTaxRateInput,
  createAuditedTaxRateWorkflow,
  createAuditedTaxRegionWorkflow,
  updateAuditedTaxRateWorkflow,
} from "./tax-rate-audit";

interface AsyncOperation<Result> {
  (): Promise<Result>;
}

export async function createTaxRateWithAudit(
  container: MedusaContainer,
  input: AuditedCreateTaxRateInput,
): Promise<TaxRateDTO> {
  const requestFingerprint = fingerprintRequest("tax-rate.create", input);

  async function createOrReplay(): Promise<TaxRateDTO> {
    const recorded = await findRecordedOperation(container, input.operationId, requestFingerprint);
    if (recorded) {
      return retrieveRecordedTaxRate(container, recorded);
    }

    const { result } = await createAuditedTaxRateWorkflow(container).run({
      input: { ...input, requestFingerprint },
      context: { transactionId: input.operationId },
    });

    return requireTaxRate(result, "create");
  }

  return withOperationLock(container, input.operationId, createOrReplay);
}

export async function updateTaxRateWithAudit(
  container: MedusaContainer,
  input: AuditedUpdateTaxRateInput,
): Promise<TaxRateDTO> {
  const requestFingerprint = fingerprintRequest("tax-rate.update", input);

  async function updateOrReplay(): Promise<TaxRateDTO> {
    const recorded = await findRecordedOperation(container, input.operationId, requestFingerprint);
    if (recorded) {
      return retrieveRecordedTaxRate(container, recorded);
    }

    const { result } = await updateAuditedTaxRateWorkflow(container).run({
      input: { ...input, requestFingerprint },
      context: { transactionId: input.operationId },
    });

    return requireTaxRate(result, "update");
  }

  return withOperationLock(container, input.operationId, updateOrReplay);
}

export async function createTaxRegionWithAudit(
  container: MedusaContainer,
  input: AuditedCreateTaxRegionInput,
): Promise<TaxRegionDTO> {
  const requestFingerprint = fingerprintRequest("tax-region.create", input);

  async function createOrReplay(): Promise<TaxRegionDTO> {
    const recorded = await findRecordedOperation(container, input.operationId, requestFingerprint);
    if (recorded) {
      return retrieveRecordedTaxRegion(container, recorded);
    }

    const { result } = await createAuditedTaxRegionWorkflow(container).run({
      input: { ...input, requestFingerprint },
      context: { transactionId: input.operationId },
    });

    return requireTaxRegion(result);
  }

  return withOperationLock(container, input.operationId, createOrReplay);
}

async function withOperationLock<Result>(
  container: MedusaContainer,
  operationId: string,
  operation: AsyncOperation<Result>,
): Promise<Result> {
  const locking = container.resolve<ILockingModule>(Modules.LOCKING);
  return locking.execute(`tax-rate-audit:${operationId}`, operation, { timeout: 30 });
}

async function findRecordedOperation(
  container: MedusaContainer,
  operationId: string,
  requestFingerprint: string,
): Promise<TaxRateAuditOperationRecord | undefined> {
  const auditService = container.resolve<TaxRateAuditModule>(TAX_RATE_AUDIT_MODULE);
  return auditService.findRecordedOperation(operationId, requestFingerprint);
}

async function retrieveRecordedTaxRate(
  container: MedusaContainer,
  recorded: TaxRateAuditOperationRecord,
): Promise<TaxRateDTO> {
  if (recorded.resource_kind !== "tax_rate") {
    throw resourceKindError(recorded, "tax_rate");
  }

  const taxService = container.resolve<ITaxModuleService>(Modules.TAX);
  return taxService.retrieveTaxRate(recorded.resource_id);
}

async function retrieveRecordedTaxRegion(
  container: MedusaContainer,
  recorded: TaxRateAuditOperationRecord,
): Promise<TaxRegionDTO> {
  if (recorded.resource_kind !== "tax_region") {
    throw resourceKindError(recorded, "tax_region");
  }

  const taxService = container.resolve<ITaxModuleService>(Modules.TAX);
  const regions = await taxService.listTaxRegions({ id: recorded.resource_id });
  return requireTaxRegion(regions);
}

type AuditedMutationInput =
  | AuditedCreateTaxRateInput
  | AuditedUpdateTaxRateInput
  | AuditedCreateTaxRegionInput;

function fingerprintRequest(operation: string, input: AuditedMutationInput): string {
  return createHash("sha256").update(stringify({ operation, input })).digest("hex");
}

function requireTaxRate(rates: TaxRateDTO[], mutation: "create" | "update"): TaxRateDTO {
  const [rate] = rates;
  if (!rate) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `The Tax Rate ${mutation} workflow returned no Tax Rate.`,
    );
  }

  return rate;
}

function requireTaxRegion(regions: TaxRegionDTO[]): TaxRegionDTO {
  const [region] = regions;
  if (!region) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The Tax Region create workflow returned no Tax Region.",
    );
  }

  return region;
}

function resourceKindError(
  recorded: TaxRateAuditOperationRecord,
  expectedKind: "tax_rate" | "tax_region",
): MedusaError {
  return new MedusaError(
    MedusaError.Types.UNEXPECTED_STATE,
    `Audit operation ${recorded.operation_id} recorded ${recorded.resource_kind}, not ${expectedKind}.`,
  );
}
