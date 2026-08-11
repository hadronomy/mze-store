import type {
  CreateTaxRateDTO,
  CreateTaxRegionDTO,
  ITaxModuleService,
  TaxRateDTO,
  TaxRegionDTO,
  UpdateTaxRateDTO,
  IUserModuleService,
} from "@medusajs/framework/types";
import { Modules } from "@medusajs/framework/utils";
import {
  acquireLockStep,
  createTaxRatesWorkflow,
  createTaxRegionsWorkflow,
  releaseLockStep,
  updateTaxRatesWorkflow,
} from "@medusajs/medusa/core-flows";
import {
  StepResponse,
  WorkflowData,
  WorkflowResponse,
  createStep,
  createWorkflow,
  transform,
} from "@medusajs/framework/workflows-sdk";
import TaxRateAuditModuleService from "~/modules/tax-rate-audit/service";
import { TAX_RATE_AUDIT_MODULE, type TaxRateAuditActor } from "~/modules/tax-rate-audit";
import type { TaxRateChangeInput } from "~/modules/tax-rate-audit/types";

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

export type AuditedCreateTaxRegionsInput = {
  data: CreateTaxRegionDTO[];
  actor: TaxRateAuditActor;
  operationId: string;
};

const resolveActorEmailStep = createStep(
  "resolve-tax-rate-audit-actor-email",
  async (actor: TaxRateAuditActor, { container }) => {
    if (actor.kind === "system") {
      return new StepResponse(null);
    }

    const userService = container.resolve<IUserModuleService>(Modules.USER);
    const user = await userService.retrieveUser(actor.id);
    return new StepResponse(user.email);
  },
);

const loadTaxRateSnapshotStep = createStep(
  "load-tax-rate-audit-snapshot",
  async (taxRateId: string, { container }) => {
    const taxService = container.resolve<ITaxModuleService>(Modules.TAX);
    const rate = await taxService.retrieveTaxRate(taxRateId);
    const [region] = await taxService.listTaxRegions({ id: rate.tax_region_id });

    if (!region) {
      throw new Error(`Tax Region ${rate.tax_region_id} was not returned before the update.`);
    }

    return new StepResponse({ rate, region });
  },
);

type RecordCreatedTaxRatesInput = {
  rates: TaxRateDTO[];
  operationId: string;
  actor: TaxRateAuditActor;
  actorEmail: string | null;
};

const recordCreatedTaxRatesStep = createStep(
  "record-created-tax-rate-changes",
  async ({ rates, operationId, actor, actorEmail }: RecordCreatedTaxRatesInput, { container }) => {
    const taxService = container.resolve<ITaxModuleService>(Modules.TAX);
    const auditService = container.resolve<TaxRateAuditModuleService>(TAX_RATE_AUDIT_MODULE);
    const createdRecordIds: string[] = [];

    try {
      for (const [index, rate] of rates.entries()) {
        const [region] = await taxService.listTaxRegions({ id: rate.tax_region_id });

        if (!region) {
          throw new Error(`Tax Region ${rate.tax_region_id} was not returned after creation.`);
        }

        const result = await auditService.recordChange(
          toChangeInput({
            operationId: rates.length === 1 ? operationId : `${operationId}:${index}`,
            action: "created",
            rate,
            region,
            beforeRate: null,
            actor,
            actorEmail,
            occurredAt: toDate(rate.created_at),
          }),
        );

        if (result.created) {
          createdRecordIds.push(result.record.id);
        }
      }
    } catch (error) {
      await auditService.deleteRecordedChanges(createdRecordIds);
      throw error;
    }

    return new StepResponse(rates, createdRecordIds);
  },
  async (createdRecordIds, { container }) => {
    if (!createdRecordIds?.length) {
      return;
    }

    const auditService = container.resolve<TaxRateAuditModuleService>(TAX_RATE_AUDIT_MODULE);
    await auditService.deleteRecordedChanges(createdRecordIds);
  },
);

type RecordUpdatedTaxRateInput = {
  updatedRates: TaxRateDTO[];
  snapshot: TaxRateSnapshot;
  operationId: string;
  actor: TaxRateAuditActor;
  actorEmail: string | null;
};

const recordUpdatedTaxRateStep = createStep(
  "record-updated-tax-rate-change",
  async (
    { updatedRates, snapshot, operationId, actor, actorEmail }: RecordUpdatedTaxRateInput,
    { container },
  ) => {
    const [rate] = updatedRates;

    if (!rate) {
      throw new Error(`Tax Rate ${snapshot.rate.id} was not returned after the update.`);
    }

    const auditService = container.resolve<TaxRateAuditModuleService>(TAX_RATE_AUDIT_MODULE);
    const result = await auditService.recordChange(
      toChangeInput({
        operationId,
        action: "updated",
        rate,
        region: snapshot.region,
        beforeRate: snapshot.rate.rate,
        actor,
        actorEmail,
        occurredAt: toDate(rate.updated_at),
      }),
    );

    return new StepResponse(updatedRates, result.created ? [result.record.id] : []);
  },
  async (createdRecordIds, { container }) => {
    if (!createdRecordIds?.length) {
      return;
    }

    const auditService = container.resolve<TaxRateAuditModuleService>(TAX_RATE_AUDIT_MODULE);
    await auditService.deleteRecordedChanges(createdRecordIds);
  },
);

type TaxRateSnapshot = {
  rate: TaxRateDTO;
  region: TaxRegionDTO;
};

export const createAuditedTaxRateWorkflow = createWorkflow(
  { name: "create-audited-tax-rate", store: true },
  (input: WorkflowData<AuditedCreateTaxRateInput>) => {
    const actorEmail = resolveActorEmailStep(input.actor);
    const createInput = transform({ input }, ({ input: value }) => [value.data]);
    const rates = createTaxRatesWorkflow.runAsStep({ input: createInput });

    recordCreatedTaxRatesStep({
      rates,
      operationId: input.operationId,
      actor: input.actor,
      actorEmail,
    });

    return new WorkflowResponse(rates);
  },
);

export const updateAuditedTaxRateWorkflow = createWorkflow(
  { name: "update-audited-tax-rate", store: true },
  (input: WorkflowData<AuditedUpdateTaxRateInput>) => {
    // The old value is valid only while this Tax Rate stays unchanged.
    acquireLockStep({ key: input.id, timeout: 30, ttl: 120 });
    const actorEmail = resolveActorEmailStep(input.actor);
    const snapshot = loadTaxRateSnapshotStep(input.id);
    const updateInput = transform({ input, snapshot }, ({ input: value, snapshot: previous }) => {
      if (previous.rate.id !== value.id) {
        throw new Error(`Tax Rate ${value.id} changed while the update was prepared.`);
      }

      return {
        selector: { id: value.id },
        update: { ...value.data, updated_by: value.actor.id },
      };
    });
    const updatedRates = updateTaxRatesWorkflow.runAsStep({ input: updateInput });

    recordUpdatedTaxRateStep({
      updatedRates,
      snapshot,
      operationId: input.operationId,
      actor: input.actor,
      actorEmail,
    });
    releaseLockStep({ key: input.id });

    return new WorkflowResponse(updatedRates);
  },
);

const listTaxRatesForRegionsStep = createStep(
  "list-tax-rate-audit-region-rates",
  async (regionIds: string[], { container }) => {
    const taxService = container.resolve<ITaxModuleService>(Modules.TAX);
    return new StepResponse(await taxService.listTaxRates({ tax_region_id: regionIds }));
  },
);

export const createAuditedTaxRegionsWorkflow = createWorkflow(
  { name: "create-audited-tax-regions", store: true },
  (input: WorkflowData<AuditedCreateTaxRegionsInput>) => {
    const actorEmail = resolveActorEmailStep(input.actor);
    const regions = createTaxRegionsWorkflow.runAsStep({ input: input.data });
    const regionIds = transform(regions, (createdRegions) =>
      createdRegions.map((region) => region.id),
    );
    const rates = listTaxRatesForRegionsStep(regionIds);

    recordCreatedTaxRatesStep({
      rates,
      operationId: input.operationId,
      actor: input.actor,
      actorEmail,
    });

    return new WorkflowResponse(regions);
  },
);

type ChangeDetails = {
  operationId: string;
  action: "created" | "updated";
  rate: TaxRateDTO;
  region: TaxRegionDTO;
  beforeRate: number | null;
  actor: TaxRateAuditActor;
  actorEmail: string | null;
  occurredAt: Date;
};

function toChangeInput(details: ChangeDetails): TaxRateChangeInput {
  return {
    operationId: details.operationId,
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

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}
