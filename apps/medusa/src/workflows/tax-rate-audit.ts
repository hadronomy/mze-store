import type {
  CreateTaxRateDTO,
  CreateTaxRegionDTO,
  ITaxModuleService,
  TaxRateDTO,
  TaxRegionDTO,
  UpdateTaxRateDTO,
  IUserModuleService,
} from "@medusajs/framework/types";
import { MedusaError, Modules } from "@medusajs/framework/utils";
import type { StepExecutionContext } from "@medusajs/framework/workflows-sdk";
import {
  StepResponse,
  WorkflowData,
  WorkflowResponse,
  createStep,
  createWorkflow,
  transform,
} from "@medusajs/framework/workflows-sdk";
import {
  acquireLockStep,
  createTaxRatesWorkflow,
  createTaxRegionsWorkflow,
  releaseLockStep,
  updateTaxRatesWorkflow,
} from "@medusajs/medusa/core-flows";
import { TAX_RATE_AUDIT_MODULE, type TaxRateAuditActor } from "~/modules/tax-rate-audit";
import type { TaxRateAuditModule } from "~/modules/tax-rate-audit/service";
import type {
  TaxRateAuditAction,
  TaxRateAuditOperationInput,
  TaxRateChangeInput,
} from "~/modules/tax-rate-audit/types";

export type AuditedCreateTaxRateInput = {
  data: CreateTaxRateDTO;
  actor: TaxRateAuditActor;
  operationId: string;
};

export type AuditedUpdateTaxRateInput = {
  id: string;
  data: UpdateTaxRateDTO;
  actor: TaxRateAuditActor;
  operationId: string;
};

export type AuditedCreateTaxRegionInput = {
  data: CreateTaxRegionDTO;
  actor: TaxRateAuditActor;
  operationId: string;
};

type PreparedAuditedCreateTaxRateInput = AuditedCreateTaxRateInput & {
  requestFingerprint: string;
};

type PreparedAuditedUpdateTaxRateInput = AuditedUpdateTaxRateInput & {
  requestFingerprint: string;
};

type PreparedAuditedCreateTaxRegionInput = {
  data: CreateTaxRegionDTO;
  actor: TaxRateAuditActor;
  operationId: string;
  requestFingerprint: string;
};

type RecordCreatedTaxRatesInput = {
  rates: TaxRateDTO[];
  operationId: string;
  requestFingerprint: string;
  actor: TaxRateAuditActor;
  actorEmail: string | null;
};

type TaxRateSnapshot = {
  rate: TaxRateDTO;
  region: TaxRegionDTO;
};

type RecordUpdatedTaxRateInput = {
  updatedRates: TaxRateDTO[];
  snapshot: TaxRateSnapshot;
  operationId: string;
  requestFingerprint: string;
  actor: TaxRateAuditActor;
  actorEmail: string | null;
};

type RecordTaxRateOperationInput = {
  rates: TaxRateDTO[];
  mutation: "create" | "update";
  operationId: string;
  requestFingerprint: string;
};

type RecordTaxRegionOperationInput = {
  regions: TaxRegionDTO[];
  recordedRates: TaxRateDTO[];
  operationId: string;
  requestFingerprint: string;
};

type ChangeDetails = {
  operationId: string;
  requestFingerprint: string;
  action: TaxRateAuditAction;
  rate: TaxRateDTO;
  region: TaxRegionDTO;
  beforeRate: number | null;
  actor: TaxRateAuditActor;
  actorEmail: string | null;
  occurredAt: Date;
};

interface TaxRateAuditWorkflowModule extends TaxRateAuditModule {
  deleteTaxRateAuditOperations(ids: string[]): Promise<void>;
  deleteTaxRateChanges(ids: string[]): Promise<void>;
}

function requireTaxRate(rates: TaxRateDTO[], operation: "create" | "update"): TaxRateDTO {
  const [rate] = rates;
  if (!rate) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      `The Tax Rate ${operation} workflow returned no Tax Rate.`,
    );
  }

  return rate;
}

function requireTaxRegion(regions: TaxRegionDTO[]): TaxRegionDTO {
  const [region] = regions;
  if (!region || regions.length !== 1) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "The Tax Region create workflow must return one Tax Region.",
    );
  }

  return region;
}

async function resolveActorEmail(
  actor: TaxRateAuditActor,
  { container }: StepExecutionContext,
): Promise<StepResponse<string | null>> {
  if (actor.kind === "system") {
    return new StepResponse(null);
  }

  const userService = container.resolve<IUserModuleService>(Modules.USER);
  const operator = await userService.retrieveUser(actor.id);
  return new StepResponse(operator.email);
}

async function loadTaxRateSnapshot(
  taxRateId: string,
  { container }: StepExecutionContext,
): Promise<StepResponse<TaxRateSnapshot>> {
  const taxService = container.resolve<ITaxModuleService>(Modules.TAX);
  const rate = await taxService.retrieveTaxRate(taxRateId);
  const [region] = await taxService.listTaxRegions({ id: rate.tax_region_id });

  if (!region) {
    throw new Error(`Tax Region ${rate.tax_region_id} was not returned before the update.`);
  }

  return new StepResponse({ rate, region });
}

async function recordCreatedTaxRates(
  { rates, operationId, requestFingerprint, actor, actorEmail }: RecordCreatedTaxRatesInput,
  { container }: StepExecutionContext,
): Promise<StepResponse<TaxRateDTO[], string[]>> {
  const [rate] = rates;
  if (!rate) {
    return new StepResponse(rates, []);
  }
  if (rates.length > 1) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "One audited mutation returned more than one Tax Rate.",
    );
  }

  const taxService = container.resolve<ITaxModuleService>(Modules.TAX);
  const auditService = container.resolve<TaxRateAuditModule>(TAX_RATE_AUDIT_MODULE);
  const [region] = await taxService.listTaxRegions({ id: rate.tax_region_id });

  if (!region) {
    throw new Error(`Tax Region ${rate.tax_region_id} was not returned after creation.`);
  }

  const result = await auditService.recordChange(
    toChangeInput({
      operationId,
      requestFingerprint,
      action: "created",
      rate,
      region,
      beforeRate: null,
      actor,
      actorEmail,
      occurredAt: asDate(rate.created_at),
    }),
  );

  return new StepResponse(rates, result.created ? [result.record.id] : []);
}

async function recordUpdatedTaxRate(
  {
    updatedRates,
    snapshot,
    operationId,
    requestFingerprint,
    actor,
    actorEmail,
  }: RecordUpdatedTaxRateInput,
  { container }: StepExecutionContext,
): Promise<StepResponse<TaxRateDTO[], string[]>> {
  const rate = requireTaxRate(updatedRates, "update");
  const auditService = container.resolve<TaxRateAuditModule>(TAX_RATE_AUDIT_MODULE);
  const result = await auditService.recordChange(
    toChangeInput({
      operationId,
      requestFingerprint,
      action: "updated",
      rate,
      region: snapshot.region,
      beforeRate: snapshot.rate.rate,
      actor,
      actorEmail,
      occurredAt: asDate(rate.updated_at),
    }),
  );

  return new StepResponse(updatedRates, result.created ? [result.record.id] : []);
}

async function compensateRecordedChanges(
  createdRecordIds: string[] | undefined,
  { container }: StepExecutionContext,
): Promise<void> {
  if (!createdRecordIds?.length) {
    return;
  }

  const auditService = container.resolve<TaxRateAuditWorkflowModule>(TAX_RATE_AUDIT_MODULE);
  await auditService.deleteTaxRateChanges(createdRecordIds);
}

async function recordTaxRateOperation(
  { rates, mutation, operationId, requestFingerprint }: RecordTaxRateOperationInput,
  { container }: StepExecutionContext,
): Promise<StepResponse<TaxRateDTO[], string | null>> {
  const rate = requireTaxRate(rates, mutation);
  const auditService = container.resolve<TaxRateAuditModule>(TAX_RATE_AUDIT_MODULE);
  const operation: TaxRateAuditOperationInput = {
    operationId,
    requestFingerprint,
    resourceKind: "tax_rate",
    resourceId: rate.id,
  };
  const result = await auditService.recordOperation(operation);

  return new StepResponse(rates, result.created ? result.record.id : null);
}

async function recordTaxRegionOperation(
  { regions, recordedRates, operationId, requestFingerprint }: RecordTaxRegionOperationInput,
  { container }: StepExecutionContext,
): Promise<StepResponse<TaxRegionDTO[], string | null>> {
  const region = requireTaxRegion(regions);
  for (const rate of recordedRates) {
    if (rate.tax_region_id !== region.id) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Tax Rate ${rate.id} does not belong to the created Tax Region ${region.id}.`,
      );
    }
  }

  const auditService = container.resolve<TaxRateAuditModule>(TAX_RATE_AUDIT_MODULE);
  const operation: TaxRateAuditOperationInput = {
    operationId,
    requestFingerprint,
    resourceKind: "tax_region",
    resourceId: region.id,
  };
  const result = await auditService.recordOperation(operation);

  return new StepResponse(regions, result.created ? result.record.id : null);
}

async function compensateRecordedOperation(
  createdOperationId: string | null | undefined,
  { container }: StepExecutionContext,
): Promise<void> {
  if (!createdOperationId) {
    return;
  }

  const auditService = container.resolve<TaxRateAuditWorkflowModule>(TAX_RATE_AUDIT_MODULE);
  await auditService.deleteTaxRateAuditOperations([createdOperationId]);
}

async function listTaxRatesForRegions(
  regionIds: string[],
  { container }: StepExecutionContext,
): Promise<StepResponse<TaxRateDTO[]>> {
  const taxService = container.resolve<ITaxModuleService>(Modules.TAX);
  return new StepResponse(await taxService.listTaxRates({ tax_region_id: regionIds }));
}

function toCreateTaxRateInput(value: {
  input: PreparedAuditedCreateTaxRateInput;
}): CreateTaxRateDTO[] {
  return [value.input.data];
}

function toCreateTaxRegionInput(value: {
  input: PreparedAuditedCreateTaxRegionInput;
}): CreateTaxRegionDTO[] {
  return [value.input.data];
}

function toUpdateTaxRateInput(value: {
  input: PreparedAuditedUpdateTaxRateInput;
  snapshot: TaxRateSnapshot;
}) {
  if (value.snapshot.rate.id !== value.input.id) {
    throw new Error(`Tax Rate ${value.input.id} changed while the update was prepared.`);
  }

  return {
    selector: { id: value.input.id },
    update: { ...value.input.data, updated_by: value.input.actor.id },
  };
}

function toTaxRegionIds(regions: TaxRegionDTO[]): string[] {
  const ids: string[] = [];

  for (const region of regions) {
    ids.push(region.id);
  }

  return ids;
}

function composeCreateAuditedTaxRate(input: WorkflowData<PreparedAuditedCreateTaxRateInput>) {
  const actorEmail = resolveActorEmailStep(input.actor);
  const createInput = transform({ input }, toCreateTaxRateInput);
  const rates = createTaxRatesWorkflow.runAsStep({ input: createInput });

  const recordedRates = recordCreatedTaxRatesStep({
    rates,
    operationId: input.operationId,
    requestFingerprint: input.requestFingerprint,
    actor: input.actor,
    actorEmail,
  });

  const completedRates = recordTaxRateOperationStep({
    rates: recordedRates,
    mutation: "create",
    operationId: input.operationId,
    requestFingerprint: input.requestFingerprint,
  });

  return new WorkflowResponse(completedRates);
}

function composeUpdateAuditedTaxRate(input: WorkflowData<PreparedAuditedUpdateTaxRateInput>) {
  // The old value is valid only while this Tax Rate stays unchanged.
  acquireLockStep({ key: input.id, timeout: 30, ttl: 120 });
  const actorEmail = resolveActorEmailStep(input.actor);
  const snapshot = loadTaxRateSnapshotStep(input.id);
  const updateInput = transform({ input, snapshot }, toUpdateTaxRateInput);
  const updatedRates = updateTaxRatesWorkflow.runAsStep({ input: updateInput });

  const recordedRates = recordUpdatedTaxRateStep({
    updatedRates,
    snapshot,
    operationId: input.operationId,
    requestFingerprint: input.requestFingerprint,
    actor: input.actor,
    actorEmail,
  });
  const completedRates = recordTaxRateOperationStep({
    rates: recordedRates,
    mutation: "update",
    operationId: input.operationId,
    requestFingerprint: input.requestFingerprint,
  });
  releaseLockStep({ key: input.id });

  return new WorkflowResponse(completedRates);
}

function composeCreateAuditedTaxRegion(input: WorkflowData<PreparedAuditedCreateTaxRegionInput>) {
  const actorEmail = resolveActorEmailStep(input.actor);
  const createInput = transform({ input }, toCreateTaxRegionInput);
  const regions = createTaxRegionsWorkflow.runAsStep({ input: createInput });
  const regionIds = transform(regions, toTaxRegionIds);
  const rates = listTaxRatesForRegionsStep(regionIds);

  const recordedRates = recordCreatedTaxRatesStep({
    rates,
    operationId: input.operationId,
    requestFingerprint: input.requestFingerprint,
    actor: input.actor,
    actorEmail,
  });

  const completedRegions = recordTaxRegionOperationStep({
    regions,
    recordedRates,
    operationId: input.operationId,
    requestFingerprint: input.requestFingerprint,
  });

  return new WorkflowResponse(completedRegions);
}

function toChangeInput(details: ChangeDetails): TaxRateChangeInput {
  return {
    operationId: details.operationId,
    requestFingerprint: details.requestFingerprint,
    action: details.action,
    taxRateId: details.rate.id,
    taxRegionId: details.region.id,
    countryCode: details.region.country_code,
    provinceCode: details.region.province_code,
    taxRateName: details.rate.name,
    taxRateCode: details.rate.code,
    beforeRate: details.beforeRate,
    afterRate: details.rate.rate,
    actor: details.actor,
    actorEmail: details.actorEmail,
    occurredAt: details.occurredAt,
  };
}

function asDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

const resolveActorEmailStep = createStep("resolve-tax-rate-audit-actor-email", resolveActorEmail);
const loadTaxRateSnapshotStep = createStep("load-tax-rate-audit-snapshot", loadTaxRateSnapshot);
const recordCreatedTaxRatesStep = createStep(
  "record-created-tax-rate-changes",
  recordCreatedTaxRates,
  compensateRecordedChanges,
);
const recordUpdatedTaxRateStep = createStep(
  "record-updated-tax-rate-change",
  recordUpdatedTaxRate,
  compensateRecordedChanges,
);
const recordTaxRateOperationStep = createStep<
  RecordTaxRateOperationInput,
  TaxRateDTO[],
  string | null
>("record-tax-rate-audit-operation", recordTaxRateOperation, compensateRecordedOperation);
const recordTaxRegionOperationStep = createStep<
  RecordTaxRegionOperationInput,
  TaxRegionDTO[],
  string | null
>("record-tax-region-audit-operation", recordTaxRegionOperation, compensateRecordedOperation);
const listTaxRatesForRegionsStep = createStep(
  "list-tax-rate-audit-region-rates",
  listTaxRatesForRegions,
);

export const createAuditedTaxRateWorkflow = createWorkflow(
  { name: "create-audited-tax-rate", store: true },
  composeCreateAuditedTaxRate,
);

export const updateAuditedTaxRateWorkflow = createWorkflow(
  { name: "update-audited-tax-rate", store: true },
  composeUpdateAuditedTaxRate,
);

export const createAuditedTaxRegionWorkflow = createWorkflow(
  { name: "create-audited-tax-region", store: true },
  composeCreateAuditedTaxRegion,
);
