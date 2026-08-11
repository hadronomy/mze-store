import { MedusaService } from "@medusajs/framework/utils";
import TaxRateChange from "~/modules/tax-rate-audit/models/tax-rate-change";
import type { TaxRateChangeFilters, TaxRateChangeInput } from "./types";

class TaxRateAuditModuleService extends MedusaService({ TaxRateChange }) {
  async findByOperationId(operationId: string) {
    const [change] = await this.listTaxRateChanges({ operation_id: operationId }, { take: 1 });

    return change;
  }

  async recordChange(input: TaxRateChangeInput): Promise<RecordedChange> {
    const existing = await this.listTaxRateChanges(
      { operation_id: input.operationId },
      { take: 1 },
    );

    if (existing[0]) {
      if (!matchesInput(existing[0], input) && !matchesOperationResult(existing[0], input)) {
        throw new Error(`Tax Rate audit operation ${input.operationId} changed its payload.`);
      }

      return { record: existing[0], created: false };
    }

    try {
      const record = await this.createTaxRateChanges({
        operation_id: input.operationId,
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
      });

      return { record, created: true };
    } catch (error) {
      // A unique operation ID makes a concurrent retry safe. Re-read after a
      // conflict and validate the payload before treating it as a duplicate.
      const [concurrent] = await this.listTaxRateChanges(
        { operation_id: input.operationId },
        { take: 1 },
      );

      if (
        !concurrent ||
        (!matchesInput(concurrent, input) && !matchesOperationResult(concurrent, input))
      ) {
        throw error;
      }

      return { record: concurrent, created: false };
    }
  }

  async deleteRecordedChanges(ids: string[]) {
    if (ids.length) {
      await this.deleteTaxRateChanges(ids);
    }
  }

  async listChanges(input: TaxRateChangeFilters) {
    const filters = {
      ...(input.taxRateId ? { tax_rate_id: input.taxRateId } : {}),
      ...(input.taxRegionId ? { tax_region_id: input.taxRegionId } : {}),
      ...(input.provinceCode ? { province_code: input.provinceCode } : {}),
      ...(input.actorId ? { actor_id: input.actorId } : {}),
      ...(input.action ? { action: input.action } : {}),
      ...(input.occurredFrom || input.occurredTo
        ? {
            occurred_at: {
              ...(input.occurredFrom ? { $gte: input.occurredFrom } : {}),
              ...(input.occurredTo ? { $lte: input.occurredTo } : {}),
            },
          }
        : {}),
    };

    const [changes, count] = await this.listAndCountTaxRateChanges(filters, {
      take: input.limit,
      skip: input.offset,
      order: { occurred_at: "DESC", created_at: "DESC" },
    });

    return { changes, count, limit: input.limit, offset: input.offset };
  }
}

type RecordedChange = {
  record: { id: string } & Record<string, unknown>;
  created: boolean;
};

function matchesInput(existing: Record<string, unknown>, input: TaxRateChangeInput): boolean {
  return (
    existing.action === input.action &&
    existing.tax_rate_id === input.taxRateId &&
    existing.tax_region_id === input.taxRegionId &&
    existing.country_code === input.countryCode &&
    existing.province_code === input.provinceCode &&
    existing.tax_rate_name === input.taxRateName &&
    existing.tax_rate_code === input.taxRateCode &&
    existing.before_rate === input.beforeRate &&
    existing.after_rate === input.afterRate &&
    existing.actor_kind === input.actor.kind &&
    existing.actor_id === input.actor.id &&
    existing.actor_email === input.actorEmail
  );
}

function matchesOperationResult(
  existing: Record<string, unknown>,
  input: TaxRateChangeInput,
): boolean {
  return (
    existing.action === input.action &&
    existing.tax_rate_id === input.taxRateId &&
    existing.tax_region_id === input.taxRegionId &&
    existing.country_code === input.countryCode &&
    existing.province_code === input.provinceCode &&
    existing.tax_rate_name === input.taxRateName &&
    existing.tax_rate_code === input.taxRateCode &&
    existing.after_rate === input.afterRate &&
    existing.actor_kind === input.actor.kind &&
    existing.actor_id === input.actor.id
  );
}

export default TaxRateAuditModuleService;
