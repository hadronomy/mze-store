import type { InferTypeOf } from "@medusajs/framework/types";
import { UniqueConstraintViolationException } from "@medusajs/framework/mikro-orm/core";
import { MedusaService, MedusaError } from "@medusajs/framework/utils";
import { isDeepStrictEqual } from "node:util";
import TaxRateChange from "~/modules/tax-rate-audit/models/tax-rate-change";
import TaxRateAuditOperation from "~/modules/tax-rate-audit/models/tax-rate-audit-operation";
import type { TaxRateAuditOperationInput, TaxRateChangeInput, TaxRateChangeQuery } from "./types";

const CHANGE_OPERATION_ID_INDEX = "IDX_tax_rate_change_operation_id_unique";
const AUDIT_OPERATION_ID_INDEX = "IDX_tax_rate_audit_operation_id_unique";

export type TaxRateChangeRecord = InferTypeOf<typeof TaxRateChange>;
export type TaxRateAuditOperationRecord = InferTypeOf<typeof TaxRateAuditOperation>;

class TaxRateAuditModuleService extends MedusaService({ TaxRateAuditOperation, TaxRateChange }) {
  async findRecordedOperation(
    operationId: string,
    requestFingerprint: string,
  ): Promise<TaxRateAuditOperationRecord | undefined> {
    const [record] = await this.listTaxRateAuditOperations(
      { operation_id: operationId },
      { take: 1 },
    );

    if (record) {
      assertSameRequest(record, requestFingerprint);
    }

    return record;
  }

  async recordOperation(input: TaxRateAuditOperationInput): Promise<RecordedOperation> {
    const [existing] = await this.listTaxRateAuditOperations(
      { operation_id: input.operationId },
      { take: 1 },
    );

    if (existing) {
      assertSameOperation(existing, input);
      return { record: existing, created: false };
    }

    try {
      const record = await this.createTaxRateAuditOperations(toStoredOperation(input));
      return { record, created: true };
    } catch (error) {
      if (
        !(error instanceof UniqueConstraintViolationException) ||
        !isExpectedUniqueConflict(error, AUDIT_OPERATION_ID_INDEX)
      ) {
        throw error;
      }

      const [concurrent] = await this.listTaxRateAuditOperations(
        { operation_id: input.operationId },
        { take: 1 },
      );

      if (!concurrent) {
        throw error;
      }

      assertSameOperation(concurrent, input);
      return { record: concurrent, created: false };
    }
  }

  async recordChange(input: TaxRateChangeInput): Promise<RecordedChange> {
    const [existing] = await this.listTaxRateChanges(
      { operation_id: input.operationId },
      { take: 1 },
    );

    if (existing) {
      assertSameChange(existing, input);
      return { record: existing, created: false };
    }

    try {
      const record = await this.createTaxRateChanges(toStoredChange(input));
      return { record, created: true };
    } catch (error) {
      if (
        !(error instanceof UniqueConstraintViolationException) ||
        !isExpectedUniqueConflict(error, CHANGE_OPERATION_ID_INDEX)
      ) {
        throw error;
      }

      const [concurrent] = await this.listTaxRateChanges(
        { operation_id: input.operationId },
        { take: 1 },
      );

      if (!concurrent) {
        throw error;
      }

      assertSameChange(concurrent, input);
      return { record: concurrent, created: false };
    }
  }

  async listChanges(input: TaxRateChangeQuery) {
    const [changes, count] = await this.listAndCountTaxRateChanges(toStoredQuery(input), {
      take: input.limit,
      skip: input.offset,
      order: { occurred_at: "DESC", created_at: "DESC" },
    });

    return { changes, count, limit: input.limit, offset: input.offset };
  }
}

export type TaxRateAuditModule = Pick<
  TaxRateAuditModuleService,
  "findRecordedOperation" | "listChanges" | "recordChange" | "recordOperation"
>;

type RecordedChange = {
  record: TaxRateChangeRecord;
  created: boolean;
};

type RecordedOperation = {
  record: TaxRateAuditOperationRecord;
  created: boolean;
};

type StoredTaxRateChangeQuery = {
  tax_rate_id?: string;
  tax_region_id?: string;
  province_code?: string;
  actor_id?: string;
  action?: TaxRateChangeInput["action"];
  occurred_at?: {
    $gte?: Date;
    $lte?: Date;
  };
};

function assertSameChange(existing: TaxRateChangeRecord, input: TaxRateChangeInput): void {
  if (isDeepStrictEqual(toChangeInput(existing), input)) {
    return;
  }

  throw new MedusaError(
    MedusaError.Types.CONFLICT,
    `Tax Rate audit operation ${input.operationId} was already used for different values.`,
  );
}

function assertSameOperation(
  existing: TaxRateAuditOperationRecord,
  input: TaxRateAuditOperationInput,
): void {
  if (isDeepStrictEqual(toOperationInput(existing), input)) {
    return;
  }

  throw new MedusaError(
    MedusaError.Types.CONFLICT,
    `Tax Rate audit operation ${input.operationId} was already used for different values.`,
  );
}

function assertSameRequest(record: TaxRateAuditOperationRecord, requestFingerprint: string): void {
  if (record.request_fingerprint === requestFingerprint) {
    return;
  }

  throw new MedusaError(
    MedusaError.Types.CONFLICT,
    `Tax Rate audit operation ${record.operation_id} was already used for a different request.`,
  );
}

function isExpectedUniqueConflict(
  error: UniqueConstraintViolationException,
  indexName: string,
): boolean {
  const databaseMessage = `${error.message} ${error.sqlMessage ?? ""} ${error.errmsg ?? ""}`;
  return error.code === "23505" && databaseMessage.includes(indexName);
}

function toOperationInput(record: TaxRateAuditOperationRecord): TaxRateAuditOperationInput {
  return {
    operationId: record.operation_id,
    requestFingerprint: record.request_fingerprint,
    resourceKind: record.resource_kind,
    resourceId: record.resource_id,
  };
}

function toChangeInput(record: TaxRateChangeRecord): TaxRateChangeInput {
  return {
    operationId: record.operation_id,
    requestFingerprint: record.request_fingerprint,
    action: record.action,
    taxRateId: record.tax_rate_id,
    taxRegionId: record.tax_region_id,
    countryCode: record.country_code,
    provinceCode: record.province_code,
    taxRateName: record.tax_rate_name,
    taxRateCode: record.tax_rate_code,
    beforeRate: record.before_rate,
    afterRate: record.after_rate,
    actor: { kind: record.actor_kind, id: record.actor_id },
    actorEmail: record.actor_email,
    occurredAt: record.occurred_at,
  };
}

function toStoredChange(input: TaxRateChangeInput) {
  return {
    operation_id: input.operationId,
    request_fingerprint: input.requestFingerprint,
    action: input.action,
    tax_rate_id: input.taxRateId,
    tax_region_id: input.taxRegionId,
    country_code: input.countryCode,
    province_code: input.provinceCode,
    tax_rate_name: input.taxRateName,
    tax_rate_code: input.taxRateCode,
    before_rate: input.beforeRate,
    after_rate: input.afterRate,
    actor_kind: input.actor.kind,
    actor_id: input.actor.id,
    actor_email: input.actorEmail,
    occurred_at: input.occurredAt,
  };
}

function toStoredOperation(input: TaxRateAuditOperationInput) {
  return {
    operation_id: input.operationId,
    request_fingerprint: input.requestFingerprint,
    resource_kind: input.resourceKind,
    resource_id: input.resourceId,
  };
}

function toStoredQuery(input: TaxRateChangeQuery): StoredTaxRateChangeQuery {
  const query: StoredTaxRateChangeQuery = {};

  if (input.taxRateId !== undefined) {
    query.tax_rate_id = input.taxRateId;
  }
  if (input.taxRegionId !== undefined) {
    query.tax_region_id = input.taxRegionId;
  }
  if (input.provinceCode !== undefined) {
    query.province_code = input.provinceCode;
  }
  if (input.actorId !== undefined) {
    query.actor_id = input.actorId;
  }
  if (input.action !== undefined) {
    query.action = input.action;
  }
  if (input.occurredFrom !== undefined || input.occurredTo !== undefined) {
    query.occurred_at = {};
    if (input.occurredFrom !== undefined) {
      query.occurred_at.$gte = input.occurredFrom;
    }
    if (input.occurredTo !== undefined) {
      query.occurred_at.$lte = input.occurredTo;
    }
  }

  return query;
}

export default TaxRateAuditModuleService;
